import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync as fsWriteFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * 构建输出策略（2026-10-22 修）
 *
 * 历史坑（踩了两次）：把 dist/index.html 复制回根目录会覆盖 Vite 的**构建入口**，
 * 下一次构建会把旧产物当源码解析（`transformed 4 modules` 而不是 20+），
 * 但 build 依然报成功 → 用户看到的还是旧代码。
 *
 * 现在的规则：
 *   · 根目录 index.html 永远是**源入口**（引用 /src/main.tsx），谁都不许覆盖；
 *   · 构建产物写到 dist/，再由 closeBundle 钩子同步成
 *       assets/*  +  index.prod.html（manifest 指向它）
 *   · 同步完做一次**产物特征校验**，缺新代码字符串就让构建失败。
 *
 * 另外：工作区在 C:\...\WorkBuddy（D:\WorkBuddyData\... 的 junction），
 * Vite 8（rolldown）在 junction 路径下会报
 * "fileName ... must be strings that are neither absolute nor relative paths"。
 * ⇒ 请在真实路径（D:\WorkBuddyData\...）下构建，脚本会自动识别并给出提示。
 */

const REQUIRED_MARKERS = ['6e5df6', 'scan4.manifest', '扫描全库', '满屏']

function syncToPluginRoot() {
  return {
    name: 'pixcall-sync-to-plugin-root',
    apply: 'build',
    closeBundle() {
      const root = process.cwd()
      // 安全护栏：绝不覆盖源入口
      const sourceEntry = join(root, 'index.html')
      if (!existsSync(sourceEntry) || !readFileSync(sourceEntry, 'utf8').includes('/src/main.tsx')) {
        throw new Error('[build] 根目录 index.html 不是源入口（缺少 /src/main.tsx）—— 拒绝继续，避免踩历史坑')
      }

      const dist = join(root, 'dist')
      const assets = join(dist, 'assets')
      if (!existsSync(assets)) throw new Error('[build] dist/assets 不存在，构建未产出')

      const target = join(root, 'assets')
      rmSync(target, { recursive: true, force: true })
      mkdirSync(target, { recursive: true })
      for (const f of readdirSync(assets)) copyFileSync(join(assets, f), join(target, f))

      copyFileSync(join(dist, 'index.html'), join(root, 'index.prod.html'))

      // 插件在宿主里可能以 file:// 加载：去掉样式表上的 crossorigin（模块脚本保持原样）
      const prodPath = join(root, 'index.prod.html')
      const prodRaw = readFileSync(prodPath, 'utf8')
      const stripped = prodRaw.replace(/<link[^>]*>/g, (tag) => tag.replace(/\s+crossorigin(?=[\s>])/g, ''))
      fsWriteFileSync(prodPath, stripped)

      // 产物特征校验（不止「build 成功」）
      const bundle = readdirSync(target).find((f) => f.endsWith('.js'))
      if (!bundle) throw new Error('[build] assets 里没有 js 产物')
      const allText = readdirSync(target)
        .map((f) => readFileSync(join(target, f), 'utf8'))
        .join('\n')
      const missing = REQUIRED_MARKERS.filter((m) => !allText.includes(m))
      if (missing.length) {
        throw new Error(`[build] 产物缺少新代码特征：${missing.join(' / ')} —— 很可能构建入口读错了`)
      }
      const prod = readFileSync(join(root, 'index.prod.html'), 'utf8')
      const m = prod.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)
      if (!m || m[1] !== bundle) {
        throw new Error(`[build] index.prod.html 引用的产物 (${m?.[1] ?? '无'}) 与实际 (${bundle}) 不一致`)
      }
      console.log(`[build] 产物已同步：assets/${bundle} + index.prod.html（特征校验通过）`)

      // 插件目录只保留运行所需文件，dist 属于构建中间物
      rmSync(dist, { recursive: true, force: true })
    },
  }
}

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'icons/*.png', dest: 'icons', rename: { stripBase: true } },
        ...(command === 'build' ? [{ src: 'l10n/*', dest: 'l10n', rename: { stripBase: true } }] : []),
      ],
    }),
    syncToPluginRoot(),
  ],
  server: {
    strictPort: true,
    port: 5174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome146',
  },
}))
