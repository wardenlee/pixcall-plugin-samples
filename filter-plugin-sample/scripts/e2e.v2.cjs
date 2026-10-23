/*
 * 4 点改动真浏览器测试（2026-10-22 10:30）
 * 覆盖：① 窗口按钮+顶栏两行布局 ② 范围默认当前文件夹+全库切换
 *      ③ 自动载入缓存 ④ 已删除「更换范围」「应用到主界面」
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = 'C:/Users/Administrator/WorkBuddy/2026-10-12-15-11-15/pixcall-filter-probe/filter-plugin'
const PORT = 5235
const FS = 'http://127.0.0.1:1076'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' }

const REAL = [
  ['458413e9b13d7613583d22f83fa09fefb4cd015513aa57ff42ec8f3342dc15a0', '654071134770144256', '展厅-弧形墙与洽谈区.png'],
  ['bdef726b8e9541d31db670f5697d6f85fcc7f4c8c3cc4c2137a32b5cbdf356a9', '654071134711424000', '展厅-橙底壁龛与腕表广告.png'],
  ['0f6c54951c49f4d3a4dae52c99e90816a9789af5787dc851dd8a41975730f3ee', '654071134652703744', '休息区-橙绿曲面墙与蓝沙发.png'],
]
const FOLDER_ID = '506255972227851264' // 01-品牌珠宝空间-557

function mockEntries(n = 24) {
  const arr = []
  for (let i = 0; i < n; i++) {
    const r = REAL[i % REAL.length]
    arr.push({
      id: r[1] + '_' + i,
      name: `${r[2].replace('.png', '')}_${i}.png`,
      contentHash: r[0],
      thumbWidth: 480, thumbHeight: 320,
      imageWidth: 1680, imageHeight: 1120,
      mediaType: 'image', parentId: FOLDER_ID, isFolder: false,
      tagIds: i % 2 === 0 ? ['t1'] : ['t1', 't2'],
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
        res.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
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
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++; console.log(`  PASS  ${name}`)
  } else {
    fail++; console.log(`  FAIL  ${name}\n        实际=${JSON.stringify(actual)}\n        期望=${JSON.stringify(expected)}`)
  }
}

;(async () => {
  const srv = await startServer()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } })

  const errors = [], failedReq = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => failedReq.push(`${r.url()} ← ${r.failure()?.errorText}`))

  // 记录 storage 写入，模拟「上次扫描过」
  await page.addInitScript(`(() => {
    const ENTRIES = ${JSON.stringify(mockEntries())};
    const store = {};
    const calls = { resize: [], closed: false, entriesList: 0 };
    window.__calls = calls;
    // 预置一份「上次扫描」的缓存（范围 = 当前文件夹）
    const sig = { libraryPath: 'D:/1-参考案例', folderId: '${FOLDER_ID}', includeSub: true, count: ENTRIES.length };
    store['scan-manifest-v1'] = JSON.stringify({ sig, chunkCount: 1, savedAt: '2026-10-22T00:00:00Z' });
    store['scan-chunk-v1-0'] = JSON.stringify(ENTRIES.map(e => [e.id, e.contentHash, e.name, e.tagIds.join(',')]));
    const R = {
      'getContext': () => ({ library: { path: 'D:/1-参考案例', fileServer: '${FS}' },
        current: {}, env: {},
        invocation: { command: 'pixcall-filter.open', trigger: 'context_menu',
          selection: { entryIds: ['${FOLDER_ID}'] }, location: 'folder_tree' },
        view: { width: 1180, height: 820 } }),
      'library.entries.list': () => { calls.entriesList++; return { entries: ENTRIES, hasMore: false, nextCursor: null } },
      'library.tagGroups.list': () => ({ tagGroups: [{ id: 'g1', name: '2-空间（每图≤1-2）' }], hasMore: false, nextCursor: null }),
      'library.tags.list': () => ({ tags: [{ id: 't1', name: '店铺', groupId: 'g1' }, { id: 't2', name: '会所', groupId: 'g1' }], hasMore: false, nextCursor: null }),
      'library.folders.list': () => ({ folders: [{ id: '${FOLDER_ID}', name: '01-品牌珠宝空间-557', parentId: '1' }], hasMore: false, nextCursor: null }),
      'window.resize': (p) => { calls.resize.push(p); return null },
      'window.close': () => { calls.closed = true; return null },
      'plugin.storage.get': (p) => store[p.key] ?? null,
      'plugin.storage.set': (p) => { store[p.key] = p.value; return null },
      'plugin.storage.delete': (p) => { delete store[p.key]; return null },
    };
    globalThis.__PIXCALL_PRELOAD_API__ = {
      request: async (m, p) => ({ type: 'ok', result: R[m] ? R[m](p) : {} }),
      getContext: async () => R['getContext'](),
      subscribe: () => () => {},
    };
    // window.resize / close 记录
    window.__pixcallResize = (o) => { calls.resize.push(o); };
  })();`)

  console.log('== 加载（iframe 拓扑 —— Pixcall 真实用 iframe 加载插件，window.resize 才可用）==')
  // 父页面 = 假宿主，内含插件 iframe
  await page.goto(`http://127.0.0.1:${PORT}/__host.html`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    const f = document.createElement('iframe')
    f.src = '/index.prod.html'
    f.style.cssText = 'width:1180px;height:820px;border:0'
    f.id = 'pf'
    document.body.appendChild(f)
  })
  await page.waitForTimeout(800)
  const plugin = await (async () => {
    for (let i = 0; i < 30; i++) {
      const f = page.frames().find((x) => x.url().includes('index.prod.html'))
      if (f) { const ok = await f.evaluate(() => document.readyState === 'complete').catch(() => false); if (ok) return f }
      await page.waitForTimeout(200)
    }
    throw new Error('找不到插件 iframe')
  })()
  const resp = { status: () => 200 }
  check('插件页加载', resp.status(), 200)
  await plugin.waitForTimeout(2200)
  const body = await plugin.textContent('body')
  const $ = (fn) => plugin.evaluate(fn)

  console.log('\n== ① 顶栏结构 ==')
  check('标题', /Pixcall 分组筛选/.test(body), true)
  // 第1行：标题 + 数据 + 图标 + 窗口按钮
  const rowInfo = await plugin.evaluate(() => {
    const h = document.querySelector('header')
    const kids = [...h.children].map((c) => ({
      tag: c.tagName,
      text: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
      btns: c.querySelectorAll('button').length,
    }))
    const h2 = document.querySelectorAll('header')[0].nextElementSibling
    return { row1: kids, row2Tag: h2?.tagName, row2Text: (h2?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) }
  })
  console.log('        第1行:', JSON.stringify(rowInfo.row1))
  console.log('        第2行:', rowInfo.row2Text)
  check('第1行是 header', rowInfo.row1.length > 0, true)
  check('第2行存在', rowInfo.row2Tag === 'DIV', true)

  console.log('\n== ② 右上角 3 个窗口按钮 + 切换图标 ==')
  const btnInfo = await plugin.evaluate(() => {
    const h = document.querySelector('header')
    return [...h.querySelectorAll('button')].map((b) => b.getAttribute('title') || b.innerText.trim())
  })
  console.log('        header 内按钮:', JSON.stringify(btnInfo))
  check('有「缩小窗口」', btnInfo.includes('缩小窗口'), true)
  check('有「放大窗口」', btnInfo.includes('放大窗口'), true)
  check('有「关闭窗口」', btnInfo.includes('关闭窗口'), true)
  check('有筛选/看图切换', btnInfo.some((x) => x === '切到看图' || x === '切到筛选'), true)

  console.log('\n== ③ 范围默认 = 当前文件夹 ==')
  check('显示当前文件夹名', /01-品牌珠宝空间-557/.test(body), true)

  console.log('\n== ④ 自动载入缓存（不需先扫描）==')
  const c = await plugin.evaluate(() => window.__calls)
  check('未调用 entries.list（没重新扫描）', c.entriesList, 0)
  check('显示已扫描条数 24', /24\s*条/.test(body), true)
  check('不显示「未扫描」', !/未扫描/.test(body), true)

  console.log('\n== ⑤ 「更换范围」「应用到主界面」已删除 ==')
  check('无「更换范围」', !/更换范围/.test(body), true)
  check('无「应用到主界面」', !/应用到主界面/.test(body), true)

  console.log('\n== ⑥ 全库切换 ==')
  await plugin.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('01-品牌珠宝空间-557'))?.click()
  )
  await page.waitForTimeout(900)
  const body2 = await plugin.textContent('body')
  check('切到全库后显示「全库」', /全库/.test(body2), true)
  check('全库无缓存时给出提示', /扫描/.test(body2), true)

  console.log('\n== ⑦ 窗口缩小/放大 ==')
  await plugin.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '缩小窗口')
    btn?.click()
    await new Promise((r) => setTimeout(r, 500))
    const btn2 = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '放大窗口')
    btn2?.click()
    await new Promise((r) => setTimeout(r, 500))
  })
  const resizeCalls = await plugin.evaluate(() => window.__calls.resize)
  check('调用了 window.resize 两次', resizeCalls.length, 2)
  check('缩小时宽变小', resizeCalls[0]?.width < 1180, true)
  check('放大时宽变大', resizeCalls[1]?.width > resizeCalls[0]?.width, true)
  console.log('        resize 调用:', JSON.stringify(resizeCalls))

  console.log('\n== ⑧ 看图 + 滚轮 ==')
  await plugin.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '切到看图')?.click()
  )
  await page.waitForTimeout(1800)
  const imgs = await plugin.evaluate(() => {
    const l = [...document.querySelectorAll('img')]
    return { n: l.length, ok: l.filter((i) => i.complete && i.naturalWidth > 0).length, src: l[0]?.src.slice(0, 50) }
  })
  check('渲染缩略图', imgs.n > 0, true)
  check('缩略图加载成功', imgs.ok, imgs.n)
  await page.screenshot({ path: 'v2-grid.png' })

  console.log('\n== 控制台 ==')
  check('无 JS 错误', errors.length, 0)
  if (errors.length) console.log('        ' + errors.slice(0, 3).join(' | '))
  check('无失败请求', failedReq.length, 0)
  if (failedReq.length) console.log('        ' + failedReq.slice(0, 3).join(' | '))

  // 切回筛选视图截图
  await plugin.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '切到筛选')
    btn?.click()
    await new Promise((r) => setTimeout(r, 400))
    const t = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '店铺')
    t?.click()
    await new Promise((r) => setTimeout(r, 500))
  })
  await page.screenshot({ path: 'v2-filter.png' })
  console.log('        已保存 v2-filter.png')

  await browser.close()
  srv.close()
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => { console.error('测试崩溃：', e.message); process.exit(2) })
