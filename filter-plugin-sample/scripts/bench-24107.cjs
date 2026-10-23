/*
 * 真实规模基准（24,107 条）+ 缓存兼容性（v3 → 可读）
 *
 * 验三件用户最关心的事：
 *   ① 24,107 条全库扫描要多久；
 *   ② v4 缓存占多少字节 —— 必须 < 5,242,880（宿主总配额）；
 *   ③ 关掉重开是否真的不扫描，以及旧 v3 缓存能不能直接读（不让老用户重扫）。
 *
 * 运行：
 *   NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules \
 *     node scripts/bench-24107.cjs
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '..')
const PORT = 5244
const LIMIT = 5242880
const N = 24107

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
}
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const FOLDERS = Array.from({ length: 20 }, (_, i) => ({
  id: 'f' + i,
  name: `${String(i + 1).padStart(2, '0')}-文件夹-${i + 1}`,
  parentId: i === 0 ? '0' : 'f0',
  fileCount: 0,
  inTrash: false,
}))

const TAG_GROUPS = Array.from({ length: 19 }, (_, i) => ({
  id: 'g' + i,
  name: `${i + 1}-组${i + 1}（每图≤1-2）`,
}))
const TAGS = Array.from({ length: 145 }, (_, i) => ({
  id: 't' + i,
  name: '标签' + i,
  groupId: 'g' + (i % 19),
}))

function buildEntries() {
  const out = []
  for (let i = 0; i < N; i++) {
    const hash = (i.toString(16).padStart(8, '0') + 'a1b2c3d4').padEnd(64, 'f').slice(0, 64)
    const video = i % 97 === 0
    out.push({
      id: '65' + String(1000000000000000 + i),
      name: `珠宝空间参考图_${i}_中型商场店.png`,
      contentHash: hash,
      parentId: 'f' + (i % 20),
      isFolder: false,
      mediaType: video ? 'video' : 'image',
      imageWidth: video ? 1920 : 4000 + (i % 500),
      imageHeight: video ? 1080 : 3000 + (i % 300),
      tagIds: i % 5 === 0 ? [] : ['t' + (i % 145), 't' + ((i * 7) % 145)],
    })
  }
  return out
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0])
      if (url.startsWith('/thumbs/') || url.startsWith('/masters/')) {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(PNG)
        return
      }
      const file = path.join(ROOT, url === '/' ? 'index.prod.html' : url)
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
        res.end(fs.readFileSync(file))
      } else {
        res.writeHead(404)
        res.end('404')
      }
    })
    srv.listen(PORT, '127.0.0.1', () => resolve(srv))
  })
}

function preloadScript(entries) {
  return `(() => {
  const ENT = ${JSON.stringify(entries)};
  const FOLDERS = ${JSON.stringify(FOLDERS)};
  const TAGS = ${JSON.stringify(TAGS)};
  const GROUPS = ${JSON.stringify(TAG_GROUPS)};
  const LS = '__bench__:';
  const calls = { entriesList: 0 };
  window.__calls = calls;
  const enc = new TextEncoder();
  const bytes = (s) => enc.encode(s || '').length;
  const lsKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(LS));
  const total = () => lsKeys().reduce((n, k) => n + bytes(localStorage.getItem(k)), 0);
  window.__totalBytes = total;
  window.__readKey = (k) => localStorage.getItem(LS + k);
  window.__lsKeys = () => lsKeys().map((k) => k.slice(LS.length));

  const pageOf = (list, p, key) => {
    const limit = Math.max(1, Math.min(200, Number(p && p.limit) || 200));
    const start = Number((p && p.cursor) || 0) || 0;
    const slice = list.slice(start, start + limit);
    const next = start + slice.length < list.length ? String(start + slice.length) : null;
    return { [key]: slice, hasMore: next !== null, nextCursor: next };
  };

  const R = {
    'getContext': () => ({
      library: { path: 'D:/1-参考案例', fileServer: 'http://127.0.0.1:${PORT}' },
      current: {}, env: {},
      invocation: { command: 'x', trigger: 'context_menu', selection: { entryIds: ['f0'] }, location: 'folder_tree' },
      preferences: { colorMode: 'light', locale: 'zh-CN' },
      plugin: { id: 'pixcall-filter', name: 'x', version: '0.3.0', pluginPath: '/' },
      view: { width: 1180, height: 820 },
    }),
    'library.entries.list': (p) => { calls.entriesList += 1; return pageOf(ENT, p, 'entries'); },
    'library.entries.listSelected': () => ({ entries: [], hasMore: false, nextCursor: null }),
    'library.entries.getByIds': (p) => (p && p.ids ? p.ids : []).map((id) => ENT.find((e) => e.id === id)).filter(Boolean),
    'library.folders.list': () => ({ folders: FOLDERS, hasMore: false, nextCursor: null }),
    'library.tagGroups.list': () => ({ tagGroups: GROUPS, hasMore: false, nextCursor: null }),
    'library.tags.list': () => ({ tags: TAGS, hasMore: false, nextCursor: null }),
    'clipboard.copyText': () => null,
    'plugin.storage.get': (p) => localStorage.getItem(LS + p.key),
    'plugin.storage.set': (p) => {
      const before = total();
      const oldBytes = bytes(localStorage.getItem(LS + p.key));
      const newBytes = p.value == null ? 0 : bytes(String(p.value));
      if (before - oldBytes + newBytes > ${LIMIT}) throw new Error('Storage limit reached: ${LIMIT}');
      if (p.value == null) localStorage.removeItem(LS + p.key);
      else localStorage.setItem(LS + p.key, String(p.value));
      return null;
    },
    'plugin.storage.delete': (p) => { localStorage.removeItem(LS + p.key); return null; },
    'plugin.storage.clear': () => { for (const k of lsKeys()) localStorage.removeItem(k); return null; },
    'window.close': () => null,
    'window.resize': () => { throw new Error('window.resize is only available in iframe plugins'); },
  };
  globalThis.__PIXCALL_PRELOAD_API__ = {
    window: { close: () => ({ type: 'ok', result: null }) },
    clipboard: { copyText: () => ({ type: 'ok', result: null }) },
    request: async (m, p) => {
      try {
        const f = R[m];
        if (!f) throw new Error('Unsupported plugin API method: ' + m);
        return { type: 'ok', result: f(p || {}) };
      } catch (e) {
        return { type: 'error', message: e && e.message ? e.message : String(e) };
      }
    },
    getContext: async () => R['getContext'](),
    subscribe: () => () => {},
  };
})();`
}

/** 构造一份旧 v3 缓存（格式与旧代码一致），验证老用户不必重扫 */
function buildLegacyV3(entries) {
  const parents = []
  const parentIdx = new Map()
  const tags = []
  const tagIdx = new Map()
  const lines = []
  for (const e of entries) {
    let p = ''
    if (e.parentId) {
      if (!parentIdx.has(e.parentId)) {
        parentIdx.set(e.parentId, parents.length)
        parents.push(e.parentId)
      }
      p = String(parentIdx.get(e.parentId))
    }
    const ts = e.tagIds
      .map((t) => {
        if (!tagIdx.has(t)) {
          tagIdx.set(t, tags.length)
          tags.push(t)
        }
        return String(tagIdx.get(t))
      })
      .join('|')
    lines.push(`${e.id},${e.contentHash},${p},${ts},${e.name}`)
  }
  const text = lines.join('\n')
  const chunks = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (cur.length + line.length + 1 > 300000 && cur) {
      chunks.push(cur)
      cur = ''
    }
    cur += (cur ? '\n' : '') + line
  }
  if (cur) chunks.push(cur)
  return {
    manifest: JSON.stringify({
      libraryPath: 'D:/1-参考案例',
      count: entries.length,
      chunkCount: chunks.length,
      nameBytes: 60,
      savedAt: new Date().toISOString(),
    }),
    dict: JSON.stringify({ parents, tags }),
    chunks,
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`  PASS  ${name}${detail ? '  (' + detail + ')' : ''}`)
  } else {
    fail += 1
    console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`)
  }
}

;(async () => {
  const srv = await startServer()
  const entries = buildEntries()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(preloadScript(entries))

  const open = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/index.prod.html`, { waitUntil: 'load' })
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await wait(500)
  }
  const metricTotal = async () => Number((await page.locator('.metric', { hasText: '总' }).first().innerText()).replace(/[^\d]/g, ''))

  await page.goto(`http://127.0.0.1:${PORT}/index.prod.html`, { waitUntil: 'load' })
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('__bench__:')) localStorage.removeItem(k)
  })
  await open()

  console.log(`== A. 首次扫描 ${N.toLocaleString()} 条 ==`)
  const t0 = Date.now()
  await page.getByRole('button', { name: /扫描全库/ }).first().click()
  await page.waitForFunction(() => /缓存已保存|缓存保存失败/.test(document.body.innerText), null, { timeout: 180000 })
  const elapsed = Date.now() - t0
  const info = await page.evaluate(() => ({
    manifest: JSON.parse(window.__readKey('scan4.manifest')),
    total: window.__totalBytes(),
    keys: window.__lsKeys().length,
  }))
  ok('扫描 + 编码 + 写入耗时 < 120s', elapsed < 120000, `${(elapsed / 1000).toFixed(1)}s`)
  ok('缓存写入成功（schema 4）', info.manifest.schema === 4, `nameBytes=${info.manifest.nameBytes}`)
  ok('缓存总占用 < 5MB 配额', info.total < LIMIT, `${(info.total / 1048576).toFixed(2)}MB / 5.00MB（${info.keys} 个 key）`)
  ok('条目数正确', info.manifest.count === N, String(info.manifest.count))
  console.log(
    `        扫描+保存 ${(elapsed / 1000).toFixed(1)}s · 缓存 ${(info.total / 1048576).toFixed(2)}MB · 文件名上限 ${info.manifest.nameBytes}B · 分片 ${info.manifest.chunks}`,
  )

  console.log('\n== B. 关掉重开：不扫描 ==')
  await page.evaluate(() => { window.__calls.entriesList = 0 })
  const t1 = Date.now()
  await open()
  const bootMs = Date.now()
  await page.waitForFunction(() => /缓存/.test(document.body.innerText), null, { timeout: 30000 })
  const cacheMs = Date.now()
  ok('重开后 entries.list = 0', (await page.evaluate(() => window.__calls.entriesList)) === 0)
  ok('缓存载入完成 < 10s', cacheMs - t1 < 10000, `${((cacheMs - t1) / 1000).toFixed(1)}s（页面启动 ${((bootMs - t1) / 1000).toFixed(1)}s）`)
  const scope = await page.locator('.scope-main').innerText()
  ok('范围按文件夹裁剪', /文件夹/.test(scope), scope.replace(/\s+/g, ' '))
  ok('全库总数 24,107', (await metricTotal()) === N, String(await metricTotal()))

  console.log('\n== C. 旧 v3 缓存兼容（老用户不重扫） ==')
  const legacy = buildLegacyV3(entries.slice(0, 300))
  await page.evaluate((lg) => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('__bench__:')) localStorage.removeItem(k)
    localStorage.setItem('__bench__:scan3-manifest', lg.manifest)
    localStorage.setItem('__bench__:scan3-dict', lg.dict)
    lg.chunks.forEach((c, i) => localStorage.setItem('__bench__:scan3-c' + i, c))
  }, legacy)
  await page.evaluate(() => { window.__calls.entriesList = 0 })
  await open()
  const legacyText = await page.evaluate(() => document.body.innerText)
  ok('读得动 v3 缓存（显示缓存）', /缓存/.test(legacyText), (legacyText.match(/缓存[^\n]*/) || [])[0] || '')
  ok('v3 缓存没触发重扫', (await page.evaluate(() => window.__calls.entriesList)) === 0)
  ok('v3 缓存总数 = 300', (await metricTotal()) === 300, String(await metricTotal()))

  console.log('\n== D. 无未捕获错误 ==')
  ok('pageerror = 0', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  srv.close()
  console.log(`\n===== 基准结果：${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error('基准崩溃：', e && e.stack ? e.stack : e)
  process.exit(2)
})
