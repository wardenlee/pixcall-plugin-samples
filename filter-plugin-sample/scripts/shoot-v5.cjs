/*
 * 截图脚本（给用户看界面，不依赖真机宿主）
 *
 * 用 mock 宿主 + 生成的假图片，把四个界面各截一张：
 *   1 筛选页（含范围胶囊、命中数、数据来源）
 *   2 范围下拉面板（文件夹树）
 *   3 看图网格
 *   4 单图查看器（三窗口图标 + 胶片条）
 *
 * 运行：
 *   NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules \
 *     node scripts/shoot-v5.cjs
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '..')
const IMG_DIR = 'C:/Users/Administrator/AppData/Local/Temp/pixcall-shot-img'
const PORT = 5245
const shorts = (p) => path.join(ROOT, p)

const F1 = '506255972227851264'
const F1A = '506255972227851265'
const F1B = '506255972227851266'
const F2 = '641492984815133696'

const folders = [
  { id: '1', name: '参考案例', parentId: '0', fileCount: 90, inTrash: false },
  { id: F1, name: '01-品牌珠宝空间-557', parentId: '1', fileCount: 62, inTrash: false },
  { id: F1A, name: '01a-商场店-312', parentId: F1, fileCount: 40, inTrash: false },
  { id: F1B, name: '01b-街边店-245', parentId: F1, fileCount: 22, inTrash: false },
  { id: F2, name: '02-同业珠宝空间-512', parentId: '1', fileCount: 28, inTrash: false },
]

const tagGroups = [
  { id: 'g1', name: '1-品类（每图=1）' },
  { id: 'g2', name: '2-空间（每图≤1-2）' },
  { id: 'g3', name: '3-风格（每图≤1-2）' },
]
const tags = [
  { id: 't11', name: '珠宝', groupId: 'g1' },
  { id: 't12', name: '非珠宝', groupId: 'g1' },
  { id: 't13', name: '3D模型', groupId: 'g1' },
  { id: 't21', name: '店铺-商场店', groupId: 'g2' },
  { id: 't22', name: '店铺-街边店', groupId: 'g2' },
  { id: 't23', name: '展柜-中岛', groupId: 'g2' },
  { id: 't24', name: '休息区', groupId: 'g2' },
  { id: 't31', name: '酷感', groupId: 'g3' },
  { id: 't32', name: '温柔', groupId: 'g3' },
  { id: 't33', name: '极简', groupId: 'g3' },
]

const names = [
  'IMG_0921_周大福-商场店-中岛展柜.png',
  'IMG_0922_老铺黄金-街边店-橱窗.png',
  'IMG_0923_某品牌-商场中庭-酷感金属.png',
  'IMG_0924_珠宝店-入口-暖光.png',
  'IMG_0925_柜台陈列-戒指区.png',
  'IMG_0926_休息区-软装.png',
  'IMG_0927_墙面展示-极简.png',
  'IMG_0928_橱窗-丝绒背景.png',
  'IMG_0929_中岛-环形展柜.png',
  'IMG_0930_收银台-灯箱.png',
]

const entries = []
for (let i = 0; i < 90; i++) {
  const parent = i < 40 ? F1A : i < 62 ? F1B : F1
  const tagsFor = []
  tagsFor.push(i % 5 === 0 ? 't12' : i % 7 === 0 ? 't13' : 't11')
  tagsFor.push(i % 3 === 0 ? 't21' : i % 3 === 1 ? 't22' : 't23')
  if (i % 4 !== 3) tagsFor.push(i % 2 === 0 ? 't31' : 't32')
  entries.push({
    id: '65' + String(1000000000000000 + i),
    name: `${names[i % names.length].replace('.png', '')}_${i}.png`,
    contentHash: 'c' + String(i).padStart(6, '0'),
    parentId: parent,
    isFolder: false,
    mediaType: i % 23 === 0 ? 'video' : 'image',
    imageWidth: 4000 + (i % 3) * 100,
    imageHeight: 3000,
    tagIds: tagsFor,
  })
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0])
      let file = null
      if (url.startsWith('/thumbs/')) {
        const n = hashNum(url.split('/').pop()) % 12
        file = path.join(IMG_DIR, `thumb-${n}.png`)
      } else if (url.startsWith('/masters/')) {
        const n = hashNum(url.split('/').pop()) % 12
        file = path.join(IMG_DIR, `master-${n}.png`)
      } else {
        file = path.join(ROOT, url === '/' ? 'index.prod.html' : url)
      }
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file)
        res.writeHead(200, {
          'Content-Type': ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.html' ? 'text/html; charset=utf-8' : 'image/png',
        })
        res.end(fs.readFileSync(file))
      } else {
        res.writeHead(404)
        res.end('404')
      }
    })
    srv.listen(PORT, '127.0.0.1', () => resolve(srv))
  })
}

function hashNum(s) {
  let n = 0
  for (const ch of String(s)) n += ch.charCodeAt(0)
  return n
}

function preload() {
  return `(() => {
  const ENT = ${JSON.stringify(entries)};
  const FOLDERS = ${JSON.stringify(folders)};
  const TAGS = ${JSON.stringify(tags)};
  const GROUPS = ${JSON.stringify(tagGroups)};
  const LS = '__shot__:';
  const enc = new TextEncoder();
  const bytes = (s) => enc.encode(s || '').length;
  const total = () => Object.keys(localStorage).filter((k) => k.startsWith(LS)).reduce((n, k) => n + bytes(localStorage.getItem(k)), 0);
  const pageOf = (l, p, key) => { const lim = 200; const st = Number((p && p.cursor) || 0) || 0; const sl = l.slice(st, st + lim); const nx = st + sl.length < l.length ? String(st + sl.length) : null; return { [key]: sl, hasMore: nx !== null, nextCursor: nx }; };
  const R = {
    'getContext': () => ({ library: { path: 'D:/1-参考案例', fileServer: 'http://127.0.0.1:${PORT}' }, current: {}, env: {},
      invocation: { command: 'pixcall-filter.open', trigger: 'context_menu', selection: { entryIds: ['${F1}'] }, location: 'folder_tree' },
      preferences: { colorMode: 'light', locale: 'zh-CN' }, plugin: { id: 'x', name: 'x', version: '0', pluginPath: '/' }, view: { width: 1180, height: 820 } }),
    'library.entries.list': (p) => pageOf(ENT, p, 'entries'),
    'library.entries.listSelected': (p) => pageOf(ENT.slice(0, 5), p, 'entries'),
    'library.entries.getByIds': (p) => (p.ids || []).map((id) => ENT.find((e) => e.id === id)).filter(Boolean),
    'library.folders.list': () => ({ folders: FOLDERS, hasMore: false, nextCursor: null }),
    'library.tagGroups.list': () => ({ tagGroups: GROUPS, hasMore: false, nextCursor: null }),
    'library.tags.list': () => ({ tags: TAGS, hasMore: false, nextCursor: null }),
    'plugin.storage.get': (p) => localStorage.getItem(LS + p.key),
    'plugin.storage.set': (p) => { if (p.value == null) localStorage.removeItem(LS + p.key); else localStorage.setItem(LS + p.key, String(p.value)); return null; },
    'plugin.storage.delete': (p) => { localStorage.removeItem(LS + p.key); return null; },
    'plugin.storage.clear': () => { for (const k of Object.keys(localStorage)) if (k.startsWith(LS)) localStorage.removeItem(k); return null; },
    'window.close': () => null,
    'window.resize': () => { throw new Error('window.resize is only available in iframe plugins'); },
  };
  globalThis.__PIXCALL_PRELOAD_API__ = {
    window: { close: () => ({ type: 'ok', result: null }) },
    request: async (m, p) => { try { const f = R[m]; if (!f) throw new Error('Unsupported plugin API method: ' + m); return { type: 'ok', result: f(p || {}) }; } catch (e) { return { type: 'error', message: e.message }; } },
    getContext: async () => R['getContext'](),
    subscribe: () => () => {},
  };
})();`
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const srv = await startServer()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.addInitScript(preload())
  await page.goto(`http://127.0.0.1:${PORT}/index.prod.html`, { waitUntil: 'load' })
  await page.waitForSelector('.topbar')
  await wait(500)
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('__shot__:')) localStorage.removeItem(k) })
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.topbar')
  await wait(500)

  // 扫描一次，拿到全库数据
  await page.getByRole('button', { name: /扫描全库/ }).first().click()
  await page.waitForFunction(() => /缓存已保存|扫描完成/.test(document.body.innerText), null, { timeout: 30000 })
  await wait(800)

  // 选两个标签（组间且），产生命中数
  const pick = async (group, tag) => {
    const g = page.locator('.group', { hasText: group })
    await g.getByRole('button', { name: tag, exact: true }).click()
    await wait(200)
  }
  await pick('1-品类', '珠宝')
  await pick('2-空间', '店铺-商场店')
  await pick('3-风格', '酷感')
  await wait(600)
  await page.screenshot({ path: shorts('shot-v5-1-filter.png') })
  console.log('saved shot-v5-1-filter.png')

  // 范围面板
  await page.click('.scope-caret')
  await wait(400)
  await page.screenshot({ path: shorts('shot-v5-2-scope-panel.png') })
  console.log('saved shot-v5-2-scope-panel.png')
  await page.keyboard.press('Escape')
  await wait(200)

  // 网格
  await page.getByRole('button', { name: '切到看图' }).click()
  await wait(1500)
  await page.screenshot({ path: shorts('shot-v5-3-grid.png') })
  console.log('saved shot-v5-3-grid.png')

  // 查看器
  await page.locator('.grid-cell').first().click()
  await page.waitForSelector('.viewer')
  await wait(1200)
  await page.screenshot({ path: shorts('shot-v5-4-viewer.png') })
  console.log('saved shot-v5-4-viewer.png')

  // 布局度量（截图看图之外的「机械校验」：有无溢出/被裁）
  const measure = () =>
    page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
      }
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pageOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        topbar: box('.topbar'),
        topbarRight: box('.topbar-right'),
        viewerBar: box('.viewer-bar'),
        viewerWin: box('.viewer-bar .win-group'),
        viewerMedia: box('.viewer-media'),
        filmstrip: box('.filmstrip'),
      }
    })
  const m1 = await measure()
  console.log('LAYOUT@viewer', JSON.stringify(m1))
  await page.keyboard.press('Escape')
  await wait(300)
  await page.getByRole('button', { name: '切到筛选' }).click()
  await wait(300)
  await page.click('.scope-caret')
  await wait(300)
  const m2 = await page.evaluate(() => {
    const r = document.querySelector('.scope-panel').getBoundingClientRect()
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      panel: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) },
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  console.log('LAYOUT@panel', JSON.stringify(m2))
  await page.keyboard.press('Escape')
  await wait(200)

  // 最小窗口尺寸 820×560 下的溢出检查
  await page.setViewportSize({ width: 820, height: 560 })
  await wait(500)
  const m3 = await page.evaluate(() => ({
    vw: window.innerWidth,
    vh: window.innerHeight,
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pageOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    topbarH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
    winRight: Math.round(document.querySelector('.topbar-right').getBoundingClientRect().right),
    scopeW: Math.round(document.querySelector('.scope').getBoundingClientRect().width),
  }))
  console.log('LAYOUT@820x560', JSON.stringify(m3))
  await page.screenshot({ path: shorts('shot-v5-5-small-window.png') })
  console.log('saved shot-v5-5-small-window.png')

  await browser.close()
  srv.close()
  process.exit(0)
})().catch((e) => {
  console.error('截图失败：', e && e.stack ? e.stack : e)
  process.exit(1)
})
