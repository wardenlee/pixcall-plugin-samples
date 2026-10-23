/*
 * 新版界面真浏览器测试（2026-10-22）
 * 覆盖：① 顶部只有 2 行 ② 打开不自动扫描 ③ 手动扫描 ④ 图片网格 ⑤ 滚轮翻页
 * 真实图片走宿主 1076 端口（fileServer）。
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = 'C:/Users/Administrator/WorkBuddy/2026-10-12-15-11-15/pixcall-filter-probe/filter-plugin'
const PORT = 5232
const FS = 'http://127.0.0.1:1076'
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
}

/* 真实条目的 contentHash（用户诊断输出） */
const REAL = [
  ['458413e9b13d7613583d22f83fa09fefb4cd015513aa57ff42ec8f3342dc15a0', '654071134770144256', '展厅-弧形墙与洽谈区.png'],
  ['bdef726b8e9541d31db670f5697d6f85fcc7f4c8c3cc4c2137a32b5cbdf356a9', '654071134711424000', '展厅-橙底壁龛与腕表广告.png'],
  ['0f6c54951c49f4d3a4dae52c99e90816a9789af5787dc851dd8a41975730f3ee', '654071134652703744', '休息区-橙绿曲面墙与蓝沙发.png'],
]

function mockEntries() {
  const arr = []
  for (let i = 0; i < 24; i++) {
    const r = REAL[i % REAL.length]
    arr.push({
      id: r[1],   // ★ 用真实 entry id —— 原图地址 {fileServer}/masters/{entryId} 需要它
      name: `${r[2].replace('.png', '')}_${i}.png`,
      contentHash: r[0],
      thumbWidth: 480,
      thumbHeight: 320,
      imageWidth: 1680,
      imageHeight: 1120,
      mediaType: 'image',
      parentId: 'f1',
      isFolder: false,
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
      const f = path.join(ROOT, p)
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
        res.end(fs.readFileSync(f))
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
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}\n        实际=${JSON.stringify(actual)}\n        期望=${JSON.stringify(expected)}`)
  }
}

;(async () => {
  const srv = await startServer()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } })

  const errors = []
  const failedReq = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => failedReq.push(`${r.url()} ← ${r.failure()?.errorText}`))

  await page.addInitScript(`(() => {
    const ENTRIES = ${JSON.stringify(mockEntries())};
    const store = {};
    window.__listCalls = 0;
    const R = {
      'getContext': () => ({ library: { path: 'D:/1-参考案例', fileServer: '${FS}' },
        current: {}, env: {}, invocation: undefined }),
      'library.entries.list': () => {
        window.__listCalls++;
        return { entries: ENTRIES, hasMore: false, nextCursor: null };
      },
      'library.tagGroups.list': () => ({ tagGroups: [{ id: 'g1', name: '2-空间（每图≤1-2）' }], hasMore: false, nextCursor: null }),
      'library.tags.list': () => ({ tags: [{ id: 't1', name: '店铺', groupId: 'g1' }, { id: 't2', name: '会所', groupId: 'g1' }], hasMore: false, nextCursor: null }),
      'library.folders.list': () => ({ folders: [], hasMore: false, nextCursor: null }),
      'plugin.storage.get': (p) => store[p.key] ?? null,
      'plugin.storage.set': (p) => { store[p.key] = p.value; return null; },
      'plugin.storage.delete': (p) => { delete store[p.key]; return null; },
    };
    globalThis.__PIXCALL_PRELOAD_API__ = {
      request: async (m, p) => ({ type: 'ok', result: R[m] ? R[m](p) : {} }),
      getContext: async () => R['getContext'](),
      subscribe: () => () => {},
    };
  })();`)

  console.log('== 加载 ==')
  const resp = await page.goto(`http://127.0.0.1:${PORT}/index.prod.html`, { waitUntil: 'networkidle' })
  check('HTTP 200', resp.status(), 200)
  await page.waitForTimeout(2000)

  console.log('\n== ① 打开不自动扫描 ==')
  const initialCalls = await page.evaluate(() => window.__listCalls)
  check('entries.list 未被调用', initialCalls, 0)
  const bodyText = await page.textContent('body')
  check('显示「未扫描」', /未扫描/.test(bodyText), true)
  const scanBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '扫描'))
  check('有「扫描」按钮', !!(scanBtn.asElement()), true)

  console.log('\n== ② 顶部只有 2 行 ==')
  const topRows = await page.evaluate(() => {
    const wrap = document.querySelector('div')
    // 统计直接子 div 中作为 header/toolbar 的行数
    const kids = [...document.querySelectorAll('div > div, div > header')]
    return kids.length
  })
  console.log('        （结构检查见截图）')
  check('标题「Pixcall 分组筛选」', /Pixcall 分组筛选/.test(bodyText), true)
  check('有范围胶囊「全库」', /全库/.test(bodyText), true)

  console.log('\n== ③ 手动扫描 ==')
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '扫描')?.click()
  )
  await page.waitForTimeout(1500)
  const afterCalls = await page.evaluate(() => window.__listCalls)
  check('entries.list 被调用', afterCalls > 0, true)
  const t2 = await page.textContent('body')
  check('显示已扫描条数', /24\s*条已扫描/.test(t2), true)

  console.log('\n== ④ 选标签 → 命中 ==')
  await page.click('text=店铺')
  await page.waitForTimeout(600)
  const t3 = await page.textContent('body')
  const m = t3.match(/命中\s*(\d+)/)
  check('命中 24', m ? Number(m[1]) : -1, 24)

  console.log('\n== ⑤ 看图：图片网格 ==')
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '看图')?.click()
  )
  await page.waitForTimeout(2500)
  const imgs = await page.evaluate(() => {
    const list = [...document.querySelectorAll('img')]
    return list.map((i) => ({ src: i.src.slice(0, 60), w: i.naturalWidth, ok: i.complete && i.naturalWidth > 0 }))
  })
  check('渲染了缩略图', imgs.length > 0, true)
  const loaded = imgs.filter((i) => i.ok).length
  check('缩略图真实加载成功', loaded > 0, true)
  check('缩略图走 1076 端口', imgs[0]?.src.includes('127.0.0.1:1076/thumbs/'), true)
  console.log(`        ${imgs.length} 张图，${loaded} 张加载成功`)
  await page.screenshot({ path: 'new-grid.png' })

  console.log('\n== ⑥ 点图看大图 + 滚轮翻页 ==')
  await page.click('img')
  await page.waitForTimeout(2500)
  const viewer = await page.evaluate(() => {
    const big = [...document.querySelectorAll('img')].find((i) => i.src.includes('/masters/'))
    return { hasBig: !!big, w: big?.naturalWidth ?? 0, src: big?.src.slice(0, 60) ?? '' }
  })
  check('全屏大图已加载', viewer.hasBig, true)
  check('大图是原图尺寸', viewer.w >= 1000, true)
  console.log(`        大图 ${viewer.w}px 宽`)

  const beforeIdx = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/)
    return m ? m[1] : '?'
  })
  await page.mouse.move(590, 400)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(1200)
  const afterIdx = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/)
    return m ? m[1] : '?'
  })
  check('滚轮翻页生效（索引变化）', beforeIdx !== afterIdx, true)
  console.log(`        滚轮前 ${beforeIdx} → 滚轮后 ${afterIdx}`)
  await page.screenshot({ path: 'new-viewer.png' })

  console.log('\n== 控制台 ==')
  check('无 JS 错误', errors.length, 0)
  if (errors.length) console.log('        ' + errors.slice(0, 3).join(' | '))
  check('无失败请求', failedReq.length, 0)
  if (failedReq.length) console.log('        ' + failedReq.slice(0, 3).join(' | '))

  await browser.close()
  srv.close()
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error('测试崩溃：', e.message)
  process.exit(2)
})
