/*
 * v4 验证：5MB 存储限制 + 用户报的 3 个问题 + 全面排查项
 *
 * ★ 核心：mock storage 实现**真实的 5MB 总额限制**（5242880），
 *   用 24107 条（真实规模）验证能否存下、超限时能否正确降级。
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = 'C:/Users/Administrator/WorkBuddy/2026-10-12-15-11-15/pixcall-filter-probe/filter-plugin'
const PORT = 5240
const LIMIT = 5242880
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

const F1 = '506255972227851264'
const F2 = '641492984815133696'
const N = 24107 // 真实规模

/** 按真实字段长度造数据：id 18位 / hash 64位 / name 平均31字节 / tags 0-1个 */
function mockEntries() {
  const arr = []
  const hashPool = []
  for (let i = 0; i < 64; i++) {
    // 64 个不同的 64 位 hex（避免 dictionary 太大）
    hashPool.push((i.toString(16) + 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718').slice(0, 64))
  }
  for (let i = 0; i < N; i++) {
    const folder = i % 5 === 0 ? F2 : F1
    arr.push({
      id: '65' + String(1000000000000000 + i), // 18 位
      name: `珠宝店参考图_${i}_中型商场店.png`, // 约 31 字节
      contentHash: hashPool[i % hashPool.length],
      parentId: folder,
      isFolder: false,
      tagIds: i % 4 === 0 ? [] : ['t' + (i % 40)], // 0-1 个标签
    })
  }
  return arr
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0])
      if (p === '/' || p === '') p = '/index.prod.html'
      if (p === '/__host.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>')
        return
      }
      const f = path.join(ROOT, p)
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
        res.end(fs.readFileSync(f))
      } else { res.writeHead(404); res.end('404') }
    })
    srv.listen(PORT, '127.0.0.1', () => resolve(srv))
  })
}

let pass = 0, fail = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  (' + detail + ')' : ''}`) }
  else { fail++; fails.push(name); console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`) }
}
function eq(n, a, b) { ok(n, JSON.stringify(a) === JSON.stringify(b), `实际=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`) }

const PRELOAD = (entriesJson) => `(() => {
  const host = window.parent !== window ? window.parent : window;
  if (!host.__store) { host.__store = {}; host.__bytes = 0; host.__limitHit = 0; }
  if (!host.__calls) host.__calls = { entriesList: 0, resizeTo: 0, close: 0 };
  const store = host.__store;
  const calls = host.__calls;
  const LIMIT = ${LIMIT};
  const ENT = ${entriesJson};

  const R = {
    'getContext': () => ({
      library: { path: 'D:/1-参考案例', fileServer: 'http://127.0.0.1:9' },  // 无效端口，图片必失败（本测试不关心图片）
      current: {}, env: {},
      invocation: { command: 'x', trigger: 'context_menu',
        selection: { entryIds: [host.__curFolder || '${F1}'] }, location: 'folder_tree' },
      view: { width: 1180, height: 820 },
    }),
    'window.resize': () => { throw new Error('window.resize is only available in iframe plugins') },
    'window.close': () => { calls.close++; return null },
    'library.entries.list': () => { calls.entriesList++; return { entries: ENT, hasMore: false, nextCursor: null } },
    'library.tagGroups.list': () => ({ tagGroups: Array.from({ length: 19 }, (_, i) => ({ id: 'g' + i, name: (i + 1) + '-组（每图≤2）' })), hasMore: false, nextCursor: null }),
    'library.tags.list': () => ({ tags: Array.from({ length: 40 }, (_, i) => ({ id: 't' + i, name: '标签' + i, groupId: 'g' + (i % 19) })), hasMore: false, nextCursor: null }),
    'library.folders.list': () => ({ folders: [
      { id: '${F1}', name: '01-品牌珠宝空间-557', parentId: '1' },
      { id: '${F2}', name: '02-同业珠宝空间-312', parentId: '1' },
    ], hasMore: false, nextCursor: null }),
    // ★ 真实 5MB 总额限制
    'plugin.storage.get': (p) => store[p.key] ?? null,
    'plugin.storage.set': (p) => {
      const prev = store[p.key] ? store[p.key].length : 0;
      const next = p.value ? p.value.length : 0;
      const delta = next - prev;
      if (host.__bytes + delta > LIMIT) {
        host.__limitHit++;
        throw new Error('encountered unexpected or invalid data: Storage limit reached: 5242880');
      }
      if (p.value == null) delete store[p.key]; else store[p.key] = p.value;
      host.__bytes += delta;
      return null;
    },
    'plugin.storage.delete': (p) => {
      const prev = store[p.key] ? store[p.key].length : 0;
      delete store[p.key];
      host.__bytes -= prev;
      return null;
    },
  };
  globalThis.__PIXCALL_PRELOAD_API__ = {
    request: async (m, p) => ({ type: 'ok', result: R[m] ? R[m](p) : {} }),
    getContext: async () => R['getContext'](),
    subscribe: () => () => {},
  };
  window.__calls = calls;
})();`

;(async () => {
  const srv = await startServer()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  console.log('== 准备数据（24107 条，真实规模）==')
  const entries = mockEntries()
  console.log(`        ${entries.length} 条`)

  await page.addInitScript(PRELOAD(JSON.stringify(entries)))
  // 预置「旧 v2 缓存残留」占满空间，验证 hardClear 能否清掉
  await page.goto(`http://127.0.0.1:${PORT}/__host.html`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    // 模拟 v2 残留：接近 5MB
    const big = 'x'.repeat(900000)
    for (let i = 0; i < 5; i++) window.__store['scan2-c' + i] = big
    window.__bytes = 4500000
  })
  const beforeBytes = await page.evaluate(() => window.__bytes)
  console.log(`        预置残留：${(beforeBytes / 1048576).toFixed(2)} MB（模拟 v2 卡在 5MB）`)

  const openPlugin = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('iframe').forEach((f) => f.remove())
      const f = document.createElement('iframe')
      f.src = '/index.prod.html?v=' + Date.now()
      f.style.cssText = 'width:1180px;height:820px;border:0'
      document.body.appendChild(f)
    })
    await page.waitForTimeout(900)
    for (let i = 0; i < 50; i++) {
      const f = page.frames().find((x) => x.url().includes('index.prod.html'))
      if (f) {
        const d = await f.evaluate(() => document.readyState === 'complete').catch(() => false)
        if (d) { await f.waitForTimeout(2000); return f }
      }
      await page.waitForTimeout(200)
    }
    throw new Error('无 iframe')
  }

  const clickText = async (fr, txt) => {
    await fr.evaluate((t) => {
      [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === t)?.click()
    }, txt)
    await fr.waitForTimeout(500)
  }

  console.log('\n== 首次打开 ==')
  let fr = await openPlugin()
  let body = await fr.textContent('body')
  ok('界面已就绪（非加载中）', !/正在加载/.test(body), body.slice(0, 60).replace(/\n/g, ' '))

  console.log('\n== ★ 关键：5MB 限制下扫描 24107 条并保存 ==')
  await clickText(fr, '扫描')
  // 扫描 24107 条 + 编码 + 写 5MB 需要时间
  await fr.waitForTimeout(15000)

  const state = await page.evaluate(() => ({
    bytes: window.__bytes,
    limitHit: window.__limitHit,
    keys: Object.keys(window.__store).filter((k) => k.startsWith('scan3')),
    chunks: Object.keys(window.__store).filter((k) => /^scan3-c\d+$/.test(k)).length,
  }))
  const text1 = await fr.textContent('body')
  console.log(`        当前占用 ${(state.bytes / 1048576).toFixed(2)} MB / 5.00 MB`)
  ok('旧 v2 残留已被清掉', !Object.keys(await page.evaluate(() => window.__store)).some((k) => k.startsWith('scan2-')),
     '')
  ok('★ 缓存写入成功（有 scan3 key）', state.keys.length > 0, `${state.keys.length} 个 key，${state.chunks} 片`)
  ok('★ 未触发 5MB 超限', state.limitHit === 0, `超限次数 ${state.limitHit}`)
  ok('界面显示缓存信息', /缓存\s*24,?107\s*条/.test(text1), (text1.match(/缓存[^\n]{0,50}/) || [])[0] || '无')

  console.log('\n== ★ 关掉再打开：不重扫 ==')
  await page.evaluate(() => { window.__calls.entriesList = 0 })
  fr = await openPlugin()
  const re = await fr.evaluate(() => ({ list: window.parent.__calls.entriesList, text: document.body.innerText }))
  ok('★ 重开后 entries.list 未被调用', re.list === 0, `调用 ${re.list} 次`)
  ok('★ 重开后自动载入缓存', /缓存\s*24,?107\s*条/.test(re.text), (re.text.match(/缓存[^\n]{0,40}/) || [])[0] || '无')

  console.log('\n== 问题1：切换当前目录 / 全库 ==')
  const scopeOf = (t) => (t.match(/(01-品牌珠宝空间-557|02-同业珠宝空间-312|全库)/) || [])[1] || '?'
  const s0 = scopeOf(re.text)
  await fr.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('切到全库'))?.click()
  })
  await fr.waitForTimeout(800)
  const s1 = scopeOf(await fr.textContent('body'))
  ok('能切到全库', s1 === '全库', `${s0} → ${s1}`)
  await fr.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('切回'))?.click()
  })
  await fr.waitForTimeout(1200)
  const s2 = scopeOf(await fr.textContent('body'))
  ok('★ 能切回当前文件夹（不再依赖 invocation）', s2 === s0, `全库 → ${s2}`)
  eq('切范围未触发重扫', await fr.evaluate(() => window.parent.__calls.entriesList), 0)

  console.log('\n== 问题2：resizeTo 副作用已移除 ==')
  await fr.evaluate(() => {
    // 监控是否调用 resizeTo
    const orig = window.resizeTo
    window.resizeTo = function () { window.parent.__calls.resizeTo++; return orig.apply(window, arguments) }
  })
  await fr.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('最大化'))?.click()
  })
  await fr.waitForTimeout(800)
  eq('未调用 window.resizeTo（避免窗口锁死）', await fr.evaluate(() => window.parent.__calls.resizeTo), 0)
  const winMsg = await fr.textContent('body')
  ok('给出可操作提示而非原始错误',
     /拖动窗口边缘|系统最大化/.test(winMsg) && !/only available in iframe/.test(winMsg),
     (winMsg.match(/[^\n]*(拖动窗口边缘|系统最大化)[^\n]*/) || [])[0] || '')
  const wb = await fr.evaluate(() => [...document.querySelectorAll('header button')].map((b) => b.getAttribute('title')).filter(Boolean))
  ok('顶栏 3 个窗口按钮仍在', wb.filter((t) => /还原|最大化/.test(t)).length >= 2 && wb.includes('关闭'), wb.join(' / '))

  console.log('\n== 问题3：侧拉条已禁用 ==')
  const scrollState = await fr.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    pageScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight + 2,
  }))
  eq('body overflow=hidden', scrollState.bodyOverflow, 'hidden')
  eq('html overflow=hidden', scrollState.htmlOverflow, 'hidden')
  ok('页面本身不产生滚动条', !scrollState.pageScrollable, `scrollHeight>clientHeight = ${scrollState.pageScrollable}`)

  console.log('\n== 全面排查：大结果集渲染 ==')
  await fr.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '') === '切到看图')?.click()
  })
  await fr.waitForTimeout(2500)
  const gridInfo = await fr.evaluate(() => {
    const imgs = document.querySelectorAll('img[src*="/thumbs/"]')
    const cells = document.querySelectorAll('div[style*="grid-template-columns"] > button')
    return { imgs: imgs.length, cells: cells.length, text: document.body.innerText }
  })
  ok('★ 网格未一次渲染全部（增量 300）', gridInfo.cells <= 320, `渲染 ${gridInfo.cells} 个格子（共 24107 条）`)
  ok('显示「继续滚动加载」提示', /继续滚动加载/.test(gridInfo.text),
     (gridInfo.text.match(/已显示[^\n]*/) || [])[0] || '无')

  console.log('\n== 全面排查：查看器胶片条虚拟化 ==')
  await fr.evaluate(() => { document.querySelector('div[style*="grid-template-columns"] > button')?.click() })
  await fr.waitForTimeout(1800)
  const viewerInfo = await fr.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const film = btns.filter((b) => b.querySelector('img') && b.style.width === '78px')
    return { filmCount: film.length, hasViewer: !!document.querySelector('img[src*="/masters/"]') }
  })
  ok('★ 胶片条只渲染附近（±40）', viewerInfo.filmCount > 0 && viewerInfo.filmCount <= 90, `${viewerInfo.filmCount} 张`)

  console.log('\n== 控制台 ==')
  ok('无未捕获 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  srv.close()
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  if (fails.length) console.log('失败项：' + fails.join(' | '))
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => { console.error('测试崩溃：', e.message); process.exit(2) })
