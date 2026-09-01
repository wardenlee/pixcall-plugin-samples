import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const workerAssets = [
  {
    src: 'node_modules/@mlightcad/cad-simple-viewer/dist/mtext-renderer-worker.js',
    dest: 'assets',
  },
  {
    src: 'node_modules/@mlightcad/libredwg-converter/dist/libredwg-parser-worker.js',
    dest: 'assets',
  },
  {
    src: 'node_modules/@mlightcad/libredwg-converter/dist/libredwg-web.wasm',
    dest: 'assets',
  },
]

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'LICENSE', dest: '.' },
        { src: 'THIRD-PARTY-NOTICES.md', dest: '.' },
        { src: 'SOURCE.md', dest: '.' },
        {
          src: 'third-party-licenses',
          dest: '.',
        },
        { src: 'icons/icon.png', dest: 'icons' },
        { src: 'l10n/en.json', dest: 'l10n' },
        { src: 'l10n/zh-CN.json', dest: 'l10n' },
        { src: 'l10n/zh-TW.json', dest: 'l10n' },
        ...workerAssets,
      ],
    }),
  ],
  build: {
    modulePreload: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})
