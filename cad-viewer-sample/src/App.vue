<template>
  <main class="app-shell">
    <div v-if="loading" class="state">{{ messages.loading }}</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <MlCadViewer
      v-else-if="file"
      :locale="cadLocale"
      :local-file="file"
      :mode="AcEdOpenMode.Write"
      :theme="colorMode"
      :use-main-thread-draw="false"
      :progressive-rendering="true"
      @create="onCreate"
    />
    <div v-else class="state">{{ messages.waiting }}</div>
  </main>
</template>

<script setup lang="ts">
import pixcall from 'pixcall'
import type { ColorMode, PreferenceChangeEvent } from 'pixcall'
import { AcEdOpenMode } from '@mlightcad/cad-simple-viewer'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { registerLibreDwgConverter } from './registerLibreDwg'

const file = ref<File>()
const loading = ref(true)
const error = ref('')
const locale = ref('en')
const colorMode = ref<'light' | 'dark'>('light')

const cadLocale = computed(() => (locale.value.startsWith('zh') ? 'zh' : 'en'))
const messages = computed(() =>
  locale.value.startsWith('zh')
    ? {
        loading: '正在加载 CAD 图纸…',
        waiting: '等待 DWG 或 DXF 文件…',
      }
    : {
        loading: 'Loading CAD drawing…',
        waiting: 'Waiting for a DWG or DXF file…',
      }
)

function resolveColorMode(mode?: ColorMode): 'light' | 'dark' {
  return mode === 'dark' ? 'dark' : 'light'
}

function applyPreferences(preferences?: { colorMode?: ColorMode; locale?: string }) {
  locale.value = preferences?.locale ?? 'en'
  colorMode.value = resolveColorMode(preferences?.colorMode)
  document.documentElement.dataset.colorMode = colorMode.value
}

async function loadCurrentFile() {
  try {
    const context = await pixcall.getContext()
    applyPreferences(context?.preferences)
    const url = context?.current?.masterUrl
    if (!url) {
      throw new Error('Pixcall did not provide a file URL.')
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Unable to read drawing (${response.status}).`)
    }

    const blob = await response.blob()
    const fileName = context.current.fileName ?? 'drawing.dxf'
    file.value = new File([blob], fileName, {
      type: context.current.matchedFileType ?? blob.type,
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to load drawing.'
  } finally {
    loading.value = false
  }
}

function onCreate() {
  document.body.classList.add('cad-ready')
}

let disposePreferences: (() => void) | undefined

onMounted(() => {
  registerLibreDwgConverter()
  loadCurrentFile()

  disposePreferences = pixcall.preferences.onDidChange((event: PreferenceChangeEvent) => {
    if (event.key === 'locale') {
      locale.value = event.value
    } else if (event.key === 'colorMode') {
      colorMode.value = resolveColorMode(event.value)
    }

    document.documentElement.dataset.colorMode = colorMode.value
  })
})

function onContextMenu(event: MouseEvent) {
  if (window.getSelection()?.toString().trim()) return
  event.preventDefault()
  pixcall.menu.openDefaultAt({ x: event.clientX, y: event.clientY })
}

document.body.addEventListener('contextmenu', onContextMenu)

onBeforeUnmount(() => {
  disposePreferences?.()
  document.body.removeEventListener('contextmenu', onContextMenu)
})
</script>

<style>
:root,
body,
#app,
.app-shell {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

body {
  background: var(--cad-background);
  color: var(--cad-foreground);
  font-family: system-ui, sans-serif;
}

:root {
  --cad-background: #f8fafc;
  --cad-foreground: #1f2937;
  --cad-error: #b91c1c;
}

:root[data-color-mode='dark'] {
  --cad-background: #111827;
  --cad-foreground: #d1d5db;
  --cad-error: #fca5a5;
}

.state {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  color: var(--cad-foreground);
  background: var(--cad-background);
}

.state.error {
  padding: 24px;
  box-sizing: border-box;
  color: var(--cad-error);
  text-align: center;
}
</style>
