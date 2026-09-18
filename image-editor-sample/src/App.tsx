import { useEffect, useRef, useState } from 'react'
import ReactCrop, { type PercentCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import pixcall from 'pixcall'
import { useEditorContext } from './hooks/useEditorContext'
import { cropImage } from './lib/image'
import { resolveMessages } from './lib/l10n'

const defaultCrop: PercentCrop = { unit: '%', x: 10, y: 10, width: 80, height: 80 }

export default function App() {
  const editorState = useEditorContext()
  const messages = resolveMessages(editorState.status === 'ready' ? editorState.value.locale : undefined)

  useEffect(() => {
    const colorMode = editorState.status === 'ready' ? editorState.value.colorMode : 'system'
    const dark =
      colorMode === 'dark' ||
      (colorMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
  }, [editorState])

  if (editorState.status === 'loading') {
    return <StatusMessage text={messages['editor.loading']} />
  }

  if (editorState.status === 'empty') {
    return <StatusMessage text={messages['editor.no_image']} />
  }

  if (editorState.status === 'failed') {
    return <StatusMessage text={messages['editor.load_failed']} />
  }

  return <Editor context={editorState.value} messages={messages} />
}

function Editor({
  context,
  messages,
}: {
  context: Extract<ReturnType<typeof useEditorContext>, { status: 'ready' }>['value']
  messages: ReturnType<typeof resolveMessages>
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [crop, setCrop] = useState<PercentCrop>(defaultCrop)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const cropWidth = Math.max(1, Math.round(context.entry.imageWidth * (crop.width / 100)))
  const cropHeight = Math.max(1, Math.round(context.entry.imageHeight * (crop.height / 100)))

  async function saveCrop() {
    if (!imageRef.current || saving) {
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const { response } = await pixcall.window.showMessageBox({
        type: 'warning',
        title: messages['editor.confirm_title'],
        message: messages['editor.confirm_message'],
        buttons: [messages['editor.confirm'], messages['editor.cancel']],
        defaultId: 1,
        cancelId: 1,
      })

      if (response !== 0) {
        return
      }

      const blob = await cropImage(imageRef.current, crop, context.entry.contentType)
      const content = new Uint8Array(await blob.arrayBuffer())
      await pixcall.entries.updateContent(context.entry.id, content)
      setMessage(messages['editor.saved'])
    } catch (_error) {
      setMessage(messages['editor.save_failed'])
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="editor">
      <header className="toolbar">
        <span className="title">{context.entry.name}</span>
        <button
          aria-label={messages['editor.close']}
          className="close-button"
          title={messages['editor.close']}
          type="button"
          onClick={() => pixcall.window.close()}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <section className="workspace">
        <ReactCrop crop={crop} onChange={(_, percentCrop) => setCrop(percentCrop)}>
          <img ref={imageRef} src={context.imageUrl} alt={context.entry.name} crossOrigin="anonymous" />
        </ReactCrop>
      </section>

      <footer className="actions">
        <span className="image-info">
          <span className="dimension-badge original-dimension">
            <span className="dimension-label">{messages['editor.original_size']}</span>
            {formatPixelDimensions(context.entry.imageWidth, context.entry.imageHeight, context.locale)}
          </span>
          <span aria-hidden="true" className="dimension-separator">
            ·
          </span>
          <span className="dimension-badge crop-dimension">
            <span className="dimension-label">{messages['editor.crop_size']}</span>
            {formatPixelDimensions(cropWidth, cropHeight, context.locale)}
          </span>
        </span>
        <span className="message">{message}</span>
        <button className="save-button" type="button" disabled={saving} onClick={saveCrop}>
          {saving ? messages['editor.saving'] : messages['editor.save']}
        </button>
      </footer>
    </main>
  )
}

function StatusMessage({ text }: { text: string }) {
  return <div className="status">{text}</div>
}

function formatPixelDimensions(width: number, height: number, locale: string) {
  const formatter = new Intl.NumberFormat(locale)
  return `${formatter.format(width)} × ${formatter.format(height)}`
}
