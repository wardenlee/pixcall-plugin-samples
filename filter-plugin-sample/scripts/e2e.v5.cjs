/*
 * v0.3 端到端验证（2026-10-23）
 *
 * 覆盖用户这轮反馈：
 *   ① 文件夹面板：可折叠 + 多选并集 + 含子文件夹 + 最近使用 + 范围持久化；「跟随主界面」降级为「诊断」
 *   ② 放大：三处同源 + 满屏状态机（宿主侧靠 manifest 的 fullscreenable:true）
 *   ③ 批量标签输入：多标签分解/最长匹配/候选确认/应用后可撤销
 *   ④ 第 1 行动态数据分段（范围 │ 总 │ 命中 │ 数据）
 *   ⑤ 原有回归：零扫描、缓存命中、缓存写失败不毁旧、含逗号文件名、视频/尺寸、网格归零、查看器
 *
 * 运行：
 *   NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules \
 *     node scripts/e2e.v5.cjs
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = path.resolve(__dirname, '..')
const PORT = 5241
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

const F1 = 'f1'
const F1A = 'f1a'
const F2 = 'f2'

function buildData() {
  const folders = [
    { id: '1', name: '01-参考库', parentId: '0', fileCount: 500, inTrash: false },
    { id: F1, name: '01-品牌珠宝空间', parentId: '1', fileCount: 420, inTrash: false },
    { id: F1A, name: '01a-细分空间', parentId: F1, fileCount: 120, inTrash: false },
    { id: F2, name: '02-同业珠宝空间', parentId: '1', fileCount: 80, inTrash: false },
  ]
  const entries = []
  const push = (i, parentId, tagIds) => {
    const video = i % 50 === 1
    entries.push({
      id: '65' + String(1000000000000000 + i),
      name: i % 40 === 0 ? `IMG,2024,${String(i).padStart(3, '0')}.png` : `珠宝空间参考图_${i}.png`,
      contentHash: String(i).padStart(4, '0') + 'a'.repeat(60),
      parentId,
      isFolder: false,
      mediaType: video ? 'video' : 'image',
      imageWidth: video ? 1920 : 4000,
      imageHeight: video ? 1080 : 3000,
      tagIds,
    })
  }
  const tagsOf = (i) => {
    const out = []
    out.push(i % 3 === 0 ? 't1' : i % 3 === 1 ? 't2' : 't1')
    out.push(i % 3 === 0 ? 't3' : 't4')
    if (i % 10 === 0) out.push('t5')
    if (i % 10 === 5) out.push('t6')
    return out
  }
  for (let i = 0; i < 300; i++) push(i, F1, tagsOf(i))
  for (let i = 300; i < 420; i++) push(i, F1A, tagsOf(i))
  for (let i = 420; i < 500; i++) push(i, F2, tagsOf(i))
  entries[5].tagIds = [...entries[5].tagIds, 'u1']
  entries[6].tagIds = [...entries[6].tagIds, 'u2']
  entries[7].tagIds = [...entries[7].tagIds, 'u1', 'u2']

  return {
    folders,
    entries,
    tagGroups: [
      { id: 'g1', name: '1-品类（每图=1）' },
      { id: 'g2', name: '2-空间（每图≤1-2）' },
      { id: 'g3', name: '3-材质（每图≤3-4）' },
    ],
    tags: [
      { id: 't1', name: '珠宝', groupId: 'g1' },
      { id: 't2', name: '非珠宝', groupId: 'g1' },
      { id: 't3', name: '店铺-商场店', groupId: 'g2' },
      { id: 't4', name: '店铺-街边店', groupId: 'g2' },
      { id: 't5', name: '不锈钢、铁、铝【硬】', groupId: 'g3' },
      { id: 't6', name: '玻璃【硬】', groupId: 'g3' },
      { id: 'u1', name: '自定义甲', groupId: 'not-exist' },
      { id: 'u2', name: '自定义乙', groupId: 'not-exist' },
    ],
  }
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const raw = req.url.split('?')[0]
      const url = decodeURIComponent(raw)
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

let pass = 0
let fail = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`  PASS  ${name}${detail ? '  (' + detail + ')' : ''}`)
  } else {
    fail += 1
    fails.push(name)
    console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`)
  }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`)
}

function preloadScript(data) {
  return `(() => {
  const DATA = ${JSON.stringify(data)};
  const LS = '__pc_store__:';
  const calls = { entriesList: 0, listSelected: 0, close: 0, resize: 0, getContext: 0, resizeTo: 0 };
  window.__calls = calls;
  window.__limit = 3600000;
  window.__selectedIds = [];
  const enc = new TextEncoder();
  const bytes = (s) => enc.encode(s || '').length;
  const lsKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(LS));
  const lsGet = (k) => localStorage.getItem(LS + k);
  const total = () => lsKeys().reduce((n, k) => n + bytes(localStorage.getItem(k)), 0);
  window.__totalBytes = total;
  window.__lsKeys = () => lsKeys().map((k) => k.slice(LS.length));
  window.__readKey = (k) => lsGet(k);
  window.resizeTo = function () { calls.resizeTo += 1; };

  function pageOf(list, p) {
    const limit = Math.max(1, Math.min(200, Number(p && p.limit) || 200));
    const start = Number((p && p.cursor) || 0) || 0;
    const slice = list.slice(start, start + limit);
    const next = start + slice.length < list.length ? String(start + slice.length) : null;
    return { entries: slice, hasMore: next !== null, nextCursor: next };
  }

  const R = {
    'getContext': () => {
      calls.getContext += 1;
      const noHost = location.search.indexOf('nohost') >= 0;
      return {
        library: { path: 'D:/1-参考案例', fileServer: 'http://127.0.0.1:${PORT}' },
        current: {}, env: {},
        invocation: noHost
          ? { command: 'pixcall-filter.open', trigger: 'keybinding' }
          : { command: 'pixcall-filter.open', trigger: 'context_menu', selection: { entryIds: ['${F1}'] }, location: 'folder_tree' },
        preferences: { colorMode: 'light', locale: 'zh-CN' },
        plugin: { id: 'pixcall-filter', name: 'x', version: '0.3.0', pluginPath: '/' },
        view: { width: 1180, height: 820 },
      };
    },
    'library.entries.list': (p) => { calls.entriesList += 1; return pageOf(DATA.entries, p); },
    'library.entries.listSelected': (p) => {
      calls.listSelected += 1;
      const sel = DATA.entries.filter((e) => window.__selectedIds.includes(e.id));
      return pageOf(sel, p);
    },
    'library.entries.getByIds': (p) => (p && p.ids ? p.ids : []).map((id) => DATA.entries.find((e) => e.id === id)).filter(Boolean),
    'library.folders.list': () => ({ folders: DATA.folders, hasMore: false, nextCursor: null }),
    'library.tagGroups.list': () => ({ tagGroups: DATA.tagGroups, hasMore: false, nextCursor: null }),
    'library.tags.list': () => ({ tags: DATA.tags, hasMore: false, nextCursor: null }),
    'clipboard.copyText': () => null,
    'plugin.storage.get': (p) => lsGet(p.key),
    'plugin.storage.set': (p) => {
      const before = total();
      const oldBytes = bytes(lsGet(p.key));
      const newBytes = p.value == null ? 0 : bytes(String(p.value));
      if (before - oldBytes + newBytes > window.__limit) throw new Error('Storage limit reached: ' + window.__limit);
      if (p.value == null) localStorage.removeItem(LS + p.key);
      else localStorage.setItem(LS + p.key, String(p.value));
      return null;
    },
    'plugin.storage.delete': (p) => { localStorage.removeItem(LS + p.key); return null; },
    'plugin.storage.clear': () => { for (const k of lsKeys()) localStorage.removeItem(k); return null; },
    'window.close': () => { calls.close += 1; return null; },
    'window.resize': () => { calls.resize += 1; throw new Error('window.resize is only available in iframe plugins'); },
  };

  globalThis.__PIXCALL_PRELOAD_API__ = {
    window: { close: () => { calls.close += 1; return { type: 'ok', result: null }; } },
    clipboard: { copyText: () => ({ type: 'ok', result: null }) },
    request: async (method, params) => {
      try {
        const fn = R[method];
        if (!fn) throw new Error('Unsupported plugin API method: ' + method);
        return { type: 'ok', result: fn(params || {}) };
      } catch (e) {
        return { type: 'error', message: e && e.message ? e.message : String(e) };
      }
    },
    getContext: async () => R['getContext'](),
    subscribe: () => () => {},
  };
})();`
}

const FULLSCREEN_MOCK = `(() => {
  let fsEl = null;
  const define = () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
    document.documentElement.requestFullscreen = async () => {
      fsEl = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    document.exitFullscreen = async () => {
      fsEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  };
  if (document.documentElement) define();
  else {
    const timer = setInterval(() => {
      if (!document.documentElement) return;
      clearInterval(timer);
      define();
    }, 0);
  }
})();`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const srv = await startServer()
  const data = buildData()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })
  await page.addInitScript(FULLSCREEN_MOCK)
  await page.addInitScript(preloadScript(data))

  const open = async (search = '') => {
    await page.goto(`http://127.0.0.1:${PORT}/index.prod.html${search}`, { waitUntil: 'load' })
    await page.waitForSelector('.topbar', { timeout: 15000 })
    await wait(600)
  }
  const text = () => page.evaluate(() => document.body.innerText)
  const scopeCount = async () => Number((await page.locator('.scope-count').innerText()).replace(/[^\d]/g, ''))
  const metric = async (label) => {
    const m = await page.locator('.metric', { hasText: label }).first().innerText()
    return Number(m.replace(/[^\d]/g, ''))
  }
  const openPanel = async () => {
    await page.click('.scope-caret')
    await page.waitForSelector('.scope-panel')
    await wait(150)
  }
  const closePanel = async () => {
    await page.keyboard.press('Escape')
    await wait(150)
  }
  const folderRow = (name) => page.locator('.folder-row', { hasText: name }).first()
  const toggleFolder = async (name) => {
    await folderRow(name).locator('input[type="checkbox"]').click()
    await wait(250)
  }

  console.log('== 1. 启动（无缓存）：默认=右键带入的文件夹，不扫描 ==')
  await page.goto(`http://127.0.0.1:${PORT}/index.prod.html`, { waitUntil: 'load' })
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('__pc_store__:')) localStorage.removeItem(k)
  })
  await open()
  eq('打开时 entries.list = 0（不自动扫描）', await page.evaluate(() => window.__calls.entriesList), 0)
  ok('默认范围 = 右键带入的文件夹', (await page.locator('.scope-main').innerText()).includes('01-品牌珠宝空间'), await page.locator('.scope-main').innerText())
  eq('范围 0 条（无缓存）', await scopeCount(), 0)
  eq('第 1 行：范围=0', await metric('范围'), 0)
  eq('第 1 行：总=0', await metric('总'), 0)
  eq('第 1 行：命中=0', await metric('命中'), 0)
  ok('第 1 行：数据=未载入', /未载入/.test(await page.locator('.metric', { hasText: '数据' }).first().innerText()))
  ok('第 1 行有 3 个分隔符', (await page.locator('.metric-sep').count()) >= 3)
  const cssState = await page.evaluate(() => ({
    sheets: document.styleSheets.length,
    bg: getComputedStyle(document.querySelector('.scope-main')).backgroundColor,
  }))
  ok('样式表已加载', cssState.sheets > 0 && cssState.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(cssState))

  console.log('\n== 2. 扫描全库 + 缓存 ==')
  await page.getByRole('button', { name: '扫描全库' }).click()
  await page.waitForFunction(() => /扫描完成|缓存已保存|缓存保存失败/.test(document.body.innerText), null, { timeout: 20000 })
  await wait(700)
  ok('扫描调用了 entries.list', (await page.evaluate(() => window.__calls.entriesList)) > 0)
  const storeInfo = await page.evaluate(() => ({
    keys: window.__lsKeys(),
    bytes: window.__totalBytes(),
    manifest: JSON.parse(window.__readKey('scan4.manifest')),
  }))
  ok('缓存写入 schema 4', storeInfo.manifest.schema === 4, `${(storeInfo.bytes / 1024).toFixed(1)}KB`)
  eq('范围（F1 含子文件夹）420', await scopeCount(), 420)
  eq('第 1 行：总=500', await metric('总'), 500)
  ok('第 1 行：数据=已扫描/缓存', /已扫描|缓存/.test(await page.locator('.metric', { hasText: '数据' }).first().innerText()))

  console.log('\n== 3. 关掉重开：走缓存 + 范围恢复 ==')
  await page.evaluate(() => { window.__calls.entriesList = 0 })
  await open()
  eq('重开后 entries.list = 0', await page.evaluate(() => window.__calls.entriesList), 0)
  eq('重开后范围仍 420', await scopeCount(), 420)
  ok('数据来源是缓存', /缓存/.test(await page.locator('.metric', { hasText: '数据' }).first().innerText()))

  console.log('\n== 4. 文件夹面板：多选并集 + 折叠 ==')
  await openPanel()
  ok('面板出现文件夹树', (await page.locator('.folder-row').count()) >= 3)
  await toggleFolder('02-同业珠宝空间')
  eq('F1 + F2 并集 = 500', await scopeCount(), 500)
  ok('胶囊显示「2 个文件夹」', (await page.locator('.scope-main').innerText()).includes('2 个文件夹'), await page.locator('.scope-main').innerText())
  await toggleFolder('01-品牌珠宝空间')
  eq('只留 F2 = 80', await scopeCount(), 80)
  await toggleFolder('01-品牌珠宝空间')
  eq('再勾回 F1 = 500', await scopeCount(), 500)
  // 折叠：F1 的 caret 收起后，子文件夹 F1A 行消失
  const wrapF1 = page.locator('.folder-row-wrap', { has: page.locator('.folder-row', { hasText: '01-品牌珠宝空间' }) })
  ok('F1A 初始可见（祖先自动展开）', (await page.locator('.folder-row', { hasText: '01a-细分空间' }).count()) > 0)
  await wrapF1.locator('.folder-carets').click()
  await wait(200)
  eq('收起 F1 后子文件夹隐藏', await page.locator('.folder-row', { hasText: '01a-细分空间' }).count(), 0)
  await wrapF1.locator('.folder-carets').click()
  await wait(200)
  ok('再展开后子文件夹出现', (await page.locator('.folder-row', { hasText: '01a-细分空间' }).count()) > 0)
  // 最近使用
  ok('面板出现「最近」', /最近/.test(await page.locator('.scope-panel').innerText()))
  await closePanel()

  console.log('\n== 5. 含子文件夹（全局开关） ==')
  await page.getByRole('checkbox', { name: '含子文件夹' }).first().uncheck()
  await wait(250)
  eq('取消含子文件夹 → 500-120=380？按已选 F1+F2 计算', await scopeCount(), 300 + 80)
  await page.getByRole('checkbox', { name: '含子文件夹' }).first().check()
  await wait(250)
  eq('勾回 → 500', await scopeCount(), 500)

  console.log('\n== 5b. 搜索 + 全选 / 反选（快速选定多个文件夹） ==')
  // 先回到全库
  await openPanel()
  await page.locator('.scope-quick-btn', { hasText: '全库' }).first().click()
  await wait(250)
  eq('先回到全库 500', await scopeCount(), 500)
  await page.locator('.scope-search').fill('空间')
  await wait(300)
  const bulkLabel = await page.locator('.scope-bulk').innerText()
  ok('搜索后出现「全选结果（3）」', /全选结果（3）/.test(bulkLabel.replace(/\s+/g, '')), bulkLabel.replace(/\s+/g, ' '))
  await page.locator('.scope-bulk input[type="checkbox"]').click()
  await wait(300)
  eq('全选搜索结果 → 3 个文件夹、范围 500', await scopeCount(), 500)
  ok('胶囊显示「3 个文件夹」', (await page.locator('.scope-main').innerText()).includes('3 个文件夹'), await page.locator('.scope-main').innerText())
  // 取消其中一个 → 全选框应变成「半选」
  await toggleFolder('01-品牌珠宝空间')
  eq('取消 F1 后 = F1A(120) + F2(80) = 200', await scopeCount(), 200)
  ok(
    '全选框半选（indeterminate）',
    await page.evaluate(() => document.querySelector('.scope-bulk input[type="checkbox"]').indeterminate),
  )
  // 反选：只作用于当前搜索结果的 3 个
  await page.locator('.scope-bulk').getByRole('button', { name: '反选' }).click()
  await wait(300)
  eq('反选后只剩 F1 = 420', await scopeCount(), 420)
  ok('反选后胶囊 = 1 个文件夹名', (await page.locator('.scope-main').innerText()).includes('01-品牌珠宝空间'), await page.locator('.scope-main').innerText())
  // 再点全选（部分→全选）
  await page.locator('.scope-bulk input[type="checkbox"]').click()
  await wait(300)
  eq('再全选 = 500', await scopeCount(), 500)
  // 全选状态下再点 → 全部取消 → 全库
  await page.locator('.scope-bulk input[type="checkbox"]').click()
  await wait(300)
  eq('取消全选 → 全库 500', await scopeCount(), 500)
  ok('胶囊回到「全库」', (await page.locator('.scope-main').innerText()).includes('全库'), await page.locator('.scope-main').innerText())
  // 恢复给下一节用：只选 F1 + F2
  await toggleFolder('01-品牌珠宝空间')
  await toggleFolder('02-同业珠宝空间')
  await closePanel()
  eq('恢复 F1+F2 = 500', await scopeCount(), 500)

  console.log('\n== 6. 批量标签输入：分解 / 最长匹配 / 候选 / 应用 / 撤销 ==')
  await openPanel()
  await toggleFolder('02-同业珠宝空间')
  await closePanel()
  eq('先回到只有 F1 = 420', await scopeCount(), 420)
  const box = page.locator('.tagbox-input')
  await box.fill('珠宝 商场店 不锈钢、铁、铝【硬】')
  await wait(400)
  const candidates = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.tagbox-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
    count: document.querySelectorAll('.tagbox-row').length,
  }))
  ok('识别出 3 个标签（含带顿号的长标签）', candidates.count === 3, candidates.rows.join(' | '))
  ok('候选里出现「不锈钢、铁、铝【硬】」', candidates.rows.some((r) => r.includes('不锈钢、铁、铝【硬】')), candidates.rows.join(' | '))
  await page.getByRole('button', { name: /应用 3 个标签/ }).click()
  await wait(500)
  const applied = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.tagchips .chip')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
    hit: (document.body.innerText.match(/命中\s*([\d,]+)/) || [])[1] || '',
  }))
  eq('应用后出现 3 个已选标签 chip', applied.chips.length, 3)
  ok('应用后有命中数（不是 0）', Number(applied.hit.replace(/,/g, '')) > 0, `命中=${applied.hit}`)
  const hitBefore = Number(applied.hit.replace(/,/g, ''))
  await page.locator('.tagchips .chip', { hasText: '不锈钢、铁、铝【硬】' }).locator('.chip-x').click()
  await wait(400)
  const hitAfter = Number(((await text()).match(/命中\s*([\d,]+)/) || [])[1]?.replace(/,/g, '') || '0')
  ok('撤销一个 chip 后命中数变化（应用后可改）', hitAfter !== hitBefore, `${hitBefore} → ${hitAfter}`)
  await page.getByRole('button', { name: '清空' }).click()
  await wait(300)
  ok('清空后 chip 消失', (await page.locator('.tagchips .chip').count()) === 0)

  console.log('\n== 7. 未归类标签仍可筛 ==')
  const unmapped = page.locator('.group', { hasText: '未归类' })
  ok('出现「未归类」组', (await unmapped.count()) > 0)
  await unmapped.getByRole('button', { name: '自定义甲', exact: true }).click()
  await wait(350)
  const tagState = await page.evaluate(() => {
    const g = [...document.querySelectorAll('.group')].find((x) => x.innerText.includes('未归类'))
    const tags = [...g.querySelectorAll('.tag')].map((t) => ({ name: t.innerText.trim(), on: t.classList.contains('on') }))
    return { tags, hit: (document.body.innerText.match(/命中\s*([\d,]+)/) || [])[1] || '' }
  })
  eq('只高亮点中的那一个', tagState.tags.filter((t) => t.on).length, 1)
  ok('点未归类标签有命中', Number(tagState.hit.replace(/,/g, '')) > 0, `命中=${tagState.hit}`)
  await page.getByRole('button', { name: '清空' }).click()
  await wait(250)

  console.log('\n== 8. 诊断面板（替代假的「跟随主界面」） ==')
  await page.evaluate(() => { window.__selectedIds = ['65' + String(1000000000000000)] })
  await page.getByRole('button', { name: '诊断' }).click()
  await page.waitForSelector('.diag')
  await page.waitForFunction(() => /返回\s*1\s*条/.test(document.body.innerText), null, { timeout: 10000 })
  const diagText = await page.locator('.diag').innerText()
  ok('诊断显示 listSelected 返回 1 条', /返回\s*1\s*条/.test(diagText), (diagText.match(/返回[^\n]*/) || [])[0] || '')
  ok('诊断写明「宿主只提供勾选项」', /勾选项/.test(diagText))
  ok('诊断显示全屏能力', /fullscreenEnabled/.test(diagText))
  await page.locator('.diag-actions').getByRole('button', { name: '关闭' }).click()
  await wait(200)

  console.log('\n== 9. 网格 / 单图页 / 满屏 ==')
  await page.getByRole('button', { name: '切到看图' }).click()
  await wait(600)
  ok('网格增量渲染 <=320', (await page.evaluate(() => document.querySelectorAll('.grid-cell').length)) <= 320)
  await page.evaluate(() => { const el = document.querySelector('.grid-scroll'); el.scrollTop = 400 })
  await page.getByRole('button', { name: '切到筛选' }).click()
  await wait(200)
  await page.locator('.group', { hasText: '1-品类' }).getByRole('button', { name: '珠宝', exact: true }).click()
  await wait(300)
  await page.getByRole('button', { name: '切到看图' }).click()
  await wait(300)
  eq('换筛选后网格回到顶部', await page.evaluate(() => document.querySelector('.grid-scroll').scrollTop), 0)
  await page.locator('.grid-cell').first().click()
  await page.waitForSelector('.viewer')
  const viewer = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.viewer-bar button')].map((b) => b.getAttribute('aria-label') || b.getAttribute('title'))
    return { labels, media: Boolean(document.querySelector('.viewer-media')), text: document.querySelector('.viewer').innerText }
  })
  ok('单图页三图标齐全', ['还原', '放大', '关闭'].every((x) => viewer.labels.includes(x)), viewer.labels.join(' / '))
  ok('单图页有返回箭头', (await page.locator('.viewer-back').count()) === 1)
  const beforeIdx = await page.evaluate(() => document.querySelector('.viewer-meta').innerText)
  await page.mouse.wheel(0, 200)
  await wait(300)
  ok('滚轮翻页有效', beforeIdx !== (await page.evaluate(() => document.querySelector('.viewer-meta').innerText)))
  await page.keyboard.press('Escape')
  await wait(250)
  await page.click('.win-group [aria-label="放大"]')
  await wait(300)
  ok('点「放大」进入满屏', await page.evaluate(() => document.body.innerText.includes('满屏中')))
  await page.click('.win-group [aria-label="还原"]')
  await wait(300)
  ok('点「还原」退出满屏', await page.evaluate(() => !document.body.innerText.includes('满屏中')))
  await page.click('.win-group [aria-label="关闭"]')
  await wait(200)
  eq('关闭调用 window.close', await page.evaluate(() => window.__calls.close), 1)
  eq('全程 window.resize = 0', await page.evaluate(() => window.__calls.resize), 0)

  console.log('\n== 10. 缓存编码回归（视频 / 尺寸 / 逗号名） ==')
  await page.goto(`http://127.0.0.1:${PORT}/index.prod.html`, { waitUntil: 'load' })
  await page.waitForSelector('.topbar')
  await wait(700)
  await page.getByRole('button', { name: '切到看图' }).click()
  await wait(900)
  const cells = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.grid-cell')]
    return {
      video: list.filter((c) => c.innerText.includes('视频')).length,
      comma: list.filter((c) => (c.getAttribute('title') || '').includes('IMG,2024')).length,
    }
  })
  ok('缓存里视频仍有标记', cells.video > 0, `${cells.video}`)
  ok('含逗号文件名完整', cells.comma > 0, `${cells.comma}`)
  await page.locator('.grid-cell').first().click()
  await page.waitForSelector('.viewer')
  ok('查看器显示尺寸', /\d+×\d+/.test(await page.evaluate(() => document.querySelector('.viewer-bar').innerText)))
  await page.keyboard.press('Escape')
  await wait(200)

  console.log('\n== 11. 缓存写失败不毁旧缓存 ==')
  const genBefore = await page.evaluate(() => JSON.parse(window.__readKey('scan4.manifest')).gen)
  await page.getByRole('button', { name: '切到筛选' }).click()
  await wait(200)
  await page.evaluate(() => { window.__limit = window.__totalBytes() + 4096 })
  await page.getByRole('button', { name: /扫描全库/ }).click()
  await page.waitForFunction(() => /缓存保存失败/.test(document.body.innerText), null, { timeout: 20000 })
  await wait(400)
  eq('旧 manifest 未变', await page.evaluate(() => JSON.parse(window.__readKey('scan4.manifest')).gen), genBefore)
  await page.evaluate(() => { window.__limit = 3600000 })
  await open()
  ok('重开仍能用旧缓存', /缓存/.test(await page.locator('.metric', { hasText: '数据' }).first().innerText()))

  console.log('\n== 12. 无右键上下文时恢复上次范围 ==')
  await openPanel()
  await toggleFolder('02-同业珠宝空间')
  await toggleFolder('01-品牌珠宝空间')
  await closePanel()
  eq('此时只有 F2 = 80', await scopeCount(), 80)
  await open('?nohost=1')
  eq('无右键上下文 → 恢复上次范围 F2 = 80', await scopeCount(), 80)
  ok('胶囊显示 F2', (await page.locator('.scope-main').innerText()).includes('02-同业珠宝空间'), await page.locator('.scope-main').innerText())

  console.log('\n== 13. 控制台错误 ==')
  ok('无未捕获 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  srv.close()
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  if (fails.length) console.log('失败项：' + fails.join(' | '))
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error('测试崩溃：', e && e.stack ? e.stack : e)
  process.exit(2)
})
