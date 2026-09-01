<template>
  <main class="app-shell">
    <div v-if="loading" class="state">Loading CAD drawing…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <MlCadViewer
      v-else-if="file"
      locale="default"
      :local-file="file"
      :mode="AcEdOpenMode.Write"
      theme="dark"
      :use-main-thread-draw="false"
      :progressive-rendering="true"
      @create="onCreate"
    />
    <div v-else class="state">Waiting for a DWG or DXF file…</div>
  </main>
</template>

<script setup lang="ts">
import pixcall from 'pixcall'
import { AcEdOpenMode } from '@mlightcad/cad-simple-viewer'
import { onMounted, ref } from 'vue'
import { registerLibreDwgConverter } from './registerLibreDwg'

const file = ref<File>()
const loading = ref(true)
const error = ref('')

async function loadCurrentFile() {
  try {
    const context = await pixcall.getContext()
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

onMounted(() => {
  registerLibreDwgConverter()
  loadCurrentFile()
})

document.body.addEventListener('contextmenu', (event) => {
  if (window.getSelection()?.toString().trim()) return
  event.preventDefault()
  pixcall.menu.openDefaultAt({ x: event.clientX, y: event.clientY })
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
  background: #111827;
  font-family: system-ui, sans-serif;
}

.state {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  color: #d1d5db;
  background: #111827;
}

.state.error {
  padding: 24px;
  box-sizing: border-box;
  color: #fca5a5;
  text-align: center;
}
</style>
