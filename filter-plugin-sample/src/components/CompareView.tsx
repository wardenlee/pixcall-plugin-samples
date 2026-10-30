/*
 * 对比查看（2026-10-31）
 *
 *   · CompareView：全窗口覆盖层，并排显示 2/3/4 张图（等比完整显示，不缩放不拖动）；
 *   · ComparePicker：手动选图弹层，从「当前筛选结果」里勾 2-4 张；
 *   · 两者都不参与原有布局（fixed 覆盖），所以网格区 / 单图区的 x/y/宽/高不变。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { isAudio, isVideo, masterUrl, thumbUrl, type MediaEntry } from '../lib/media'
import type { WindowStage } from '../hooks/useWindowStage'
import { IconArrowLeft } from './Icons'
import { WindowControls } from './WindowControls'

/** 对比查看覆盖层 */
export function CompareView({
  entries,
  fileServer,
  stage,
  supported,
  onRestore,
  onMaximize,
  onCloseWindow,
  onClose,
}: {
  entries: MediaEntry[]
  fileServer: string
  stage: WindowStage
  supported: boolean
  onRestore: () => void
  onMaximize: () => void
  /** 关闭插件窗口（右上角 ✕，与筛选页/单图页同源） */
  onCloseWindow: () => void
  /** 只关对比层、回原页面（返回箭头 / Esc） */
  onClose: () => void
}) {
  const cols = entries.length <= 2 ? 2 : entries.length === 3 ? 3 : 2

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="compare" role="dialog" aria-label={`对比 ${entries.length} 张`}>
      <div className="compare-bar">
        <button type="button" className="compare-back" onClick={onClose} title="关闭对比（Esc）" aria-label="关闭对比">
          <IconArrowLeft />
        </button>
        <span className="compare-title">对比 {entries.length} 张</span>
        <span className="compare-names">
          {entries.map((e, i) => `${i + 1}. ${e.name || e.id}`).join('　')}
        </span>
        <span className="compare-hint">Esc 返回</span>
        <WindowControls
          stage={stage}
          supported={supported}
          onRestore={onRestore}
          onMaximize={onMaximize}
          onClose={onCloseWindow}
          theme="dark"
        />
      </div>

      <div className="compare-body">
        <div className="compare-grid" data-count={entries.length} style={{ ['--cmp-cols' as string]: String(cols) }}>
          {entries.map((e, i) => (
            <figure className="compare-cell" key={e.id} data-index={i + 1}>
              <img src={masterUrl(fileServer, e) ?? ''} alt={e.name || e.id} draggable={false} />
              <figcaption>
                <b>{i + 1}</b>
                <span className="compare-name" title={e.name || e.id}>
                  {e.name || e.id}
                </span>
                {e.imageWidth && e.imageHeight ? (
                  <span className="compare-size">
                    {e.imageWidth}×{e.imageHeight}
                  </span>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 手动选图（2-4 张）弹层 */
export function ComparePicker({
  entries,
  fileServer,
  preselect,
  onCancel,
  onConfirm,
}: {
  entries: MediaEntry[]
  fileServer: string
  /** 预选（从单图页进来时=当前图） */
  preselect: string[]
  onCancel: () => void
  onConfirm: (ids: string[]) => void
}) {
  const images = useMemo(() => entries.filter((e) => !isVideo(e) && !isAudio(e)), [entries])
  const idSet = useMemo(() => new Set(images.map((e) => e.id)), [images])
  const [sel, setSel] = useState<string[]>(() => preselect.filter((id) => idSet.has(id)).slice(0, 4))
  const [limit, setLimit] = useState(300)
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter' && sel.length >= 2) {
        e.stopPropagation()
        onConfirm(sel)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sel, onCancel, onConfirm])

  const toggle = (id: string) => {
    setSel((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 4) return prev
      return [...prev, id]
    })
  }

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      setLimit((n) => (n >= images.length ? n : n + 300))
    }
  }

  const shown = images.slice(0, limit)

  return (
    <div className="picker-mask" onClick={onCancel}>
      <div className="picker" role="dialog" aria-label="选择对比图片" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <b>选择对比图片</b>
          <span className="hint">
            已选 {sel.length} / 4 · 当前结果 {images.length.toLocaleString()} 张
          </span>
          <button type="button" className="picker-x" onClick={onCancel} aria-label="取消">
            ✕
          </button>
        </div>

        <div className="picker-grid" ref={scrollerRef} onScroll={onScroll}>
          {shown.map((e) => {
            const at = sel.indexOf(e.id)
            const t = thumbUrl(fileServer, e)
            return (
              <button
                type="button"
                key={e.id}
                data-id={e.id}
                className={`picker-thumb${at >= 0 ? ' on' : ''}`}
                onClick={() => toggle(e.id)}
                title={e.name || e.id}
                aria-pressed={at >= 0}
              >
                {t ? <img src={t} alt="" loading="lazy" draggable={false} /> : <span className="picker-ph">—</span>}
                {at >= 0 && <span className="pick-badge">{at + 1}</span>}
                <span className="picker-name">{e.name || e.id}</span>
              </button>
            )
          })}
          {limit < images.length && (
            <div className="picker-more">已显示 {limit.toLocaleString()} / {images.length.toLocaleString()} · 继续滚动加载</div>
          )}
        </div>

        <div className="picker-foot">
          <span className="hint">点缩略图勾选，最多 4 张；至少 2 张才能对比</span>
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn-primary" disabled={sel.length < 2} onClick={() => onConfirm(sel)}>
            开始对比（{sel.length}）
          </button>
        </div>
      </div>
    </div>
  )
}
