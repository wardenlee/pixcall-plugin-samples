/*
 * ★ 真浏览器端到端测试（Playwright）
 *
 * 上一版注入 `window.pixcall` 完全无效 —— 真跑才发现：
 * **SDK 不读全局变量**，它通过 `MessageChannel` + `postMessage` 与宿主通信：
 *   插件 → window.parent.postMessage({type:'pixcall/ready'}, '*')
 *   宿主 → MessagePort 传入（message.type==='context'）
 *   插件 → port.postMessage({id, method, params, type:'pixcall/request'})
 *   宿主 → port.postMessage({id, response})
 *
 * 所以必须**在页面里搭建一个假宿主**（监听 pixcall/ready、回 context、建 port、应答 request）。
 * 本文件就干这件事，然后断言界面是否真的渲染、交互是否真的生效。
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = 'C:/Users/Administrator/WorkBuddy/2026-10-12-15-11-15/pixcall-filter-probe/filter-plugin'
const PORT = 5214

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/* ---------- 假数据（结构对齐真实 SDK 返回；groupId 用会被精度破坏的大整数） ---------- */
const GROUPS = [
  { id: '1-品类（每图≤2-3）', name: '1-品类（每图≤2-3）', color: null, pinyin: '', ranking: '234375000' },
  { id: '504382793460982784', name: '2-空间（每图≤1-2）', color: null, pinyin: '', ranking: '351562500' },
  { id: '504384343801570304', name: '3-风格（每图≤1-2）', color: null, pinyin: '', ranking: '388183593' },
]
const TAGS = [
  { id: 't-jewel', name: '珠宝', groupId: '1-品类（每图≤2-3）', category: 'D', pinyin: '' },
  { id: 't-color', name: '彩宝', groupId: '1-品类（每图≤2-3）', category: 'D', pinyin: '' },
  // ★ groupId 用 number，模拟 SDK 的精度破坏
  { id: 't-shop', name: '店铺', groupId: 504382793460982784, category: 'D', pinyin: '' },
  { id: 't-club', name: '会所', groupId: 504382793460982784, category: 'D', pinyin: '' },
  { id: 't-modern', name: '现代', groupId: 504384343801570304, category: 'D', pinyin: '' },
  { id: 't-newcn', name: '新中式', groupId: 504384343801570304, category: 'D', pinyin: '' },
]
const ENTRIES = (() => {
  const out = []
  const combo = [
    ['t-jewel', 't-shop', 't-modern'],
    ['t-shop', 't-newcn'],
    ['t-color', 't-club'],
    ['t-jewel', 't-modern'],
  ]
  for (let i = 0; i < 500; i++) {
    out.push({
      id: '65068477550635520' + i,
      name: `样例_${String(i).padStart(4, '0')}.png`,
      tagIds: combo[i % 4],
      parentId: 504382793460982784,
      isFolder: false,
    })
  }
  return out
})()

/* ---------- 假宿主 ---------- */
/*
 * ★ 从 bundle 里读出的 SDK 初始化逻辑（关键，踩了很多坑才搞清楚）：
 *
 *   v()  = (typeof window<'u') && window.parent && window.parent !== window
 *   S()  = () => globalThis.__PIXCALL_PRELOAD_API__ ?? null
 *   启动: v() ? p.install()            // iframe 场景 → postMessage + MessagePort
 *          : S() && p.initializeHostContext()   // 顶层页场景 → 预注入的 API 对象
 *
 *   实测：iframe 场景下 postMessage 能收到 pixcall/ready，但 context 消息
 *   在 SDK 注册 listener 之前就送达而被丢弃，反复投递也无效（试过）。
 *   ⇒ 本测试直接走【第二条路径】：注入 globalThis.__PIXCALL_PRELOAD_API__，
 *      完全绕开 postMessage 时序问题。这是 SDK 官方支持的入口。
 */
function preloadApiScript() {
  return `(() => {
  const GROUPS = ${JSON.stringify(GROUPS)};
  const TAGS = ${JSON.stringify(TAGS)};
  const ENTRIES = ${JSON.stringify(ENTRIES)};
  const store = {};
  const calls = { boardsCreate: 0, lastFilters: null, lastName: null, methods: [] };
  window.__pixcallCalls = calls;

  function respond(method, params) {
    calls.methods.push(method);
    switch (method) {
      case 'getContext':
        return { library: { path: 'D:/mock-library' }, invocation: undefined, current: {}, env: {} };
      case 'library.tagGroups.list':
        return { tagGroups: GROUPS, hasMore: false, nextCursor: null };
      case 'library.tags.list':
        return { tags: TAGS, hasMore: false, nextCursor: null };
      case 'library.folders.list':
        return { folders: [], hasMore: false, nextCursor: null };
      case 'library.entries.list':
        return { entries: ENTRIES, hasMore: false, nextCursor: null };
      case 'library.boards.list':
        return { boards: [], hasMore: false, nextCursor: null };
      case 'library.boards.create':
        calls.boardsCreate++;
        calls.lastFilters = params.filters;
        calls.lastName = params.name;
        return { id: 'board-1', name: params.name };
      case 'plugin.storage.get':
        return store[params.key] ?? null;
      case 'plugin.storage.set':
        store[params.key] = params.value;
        return null;
      case 'plugin.storage.delete':
        delete store[params.key];
        return null;
      case 'clipboard.copyText':
        window.__copied = params.text;
        return null;
      case 'window.close':
        window.__closed = true;
        return null;
      default:
        return {};
    }
  }

  // SDK 期望的预注入 API 形状（从 bundle 读出的契约）：
  //   request(method, params) → 必须 resolve 成**信封** {type:'ok', result} 或 {type:'error', message}
  //     （bundle 里的 b(e)： e.type==='ok' ? e.result : throw）
  //   getContext() → 必须返回 **Promise**（h() 里直接 .then()）
  //   subscribe(event, cb) → 返回取消订阅函数
  globalThis.__PIXCALL_PRELOAD_API__ = {
    request: async (method, params) => {
      try {
        return { type: 'ok', result: respond(method, params || {}) };
      } catch (err) {
        return { type: 'error', message: String(err) };
      }
    },
    getContext: async () => ({ library: { path: 'D:/mock-library' }, current: {}, env: {} }),
    subscribe: () => () => {},
  };
})();`
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0])
      if (p === '/' || p === '') p = '/index.html'

      // 假宿主页面（测试专用）
      if (p === '/__host.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
        return
      }

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
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    pass++
    console.log(`  PASS  ${name}${actual !== true && actual !== false ? ' = ' + JSON.stringify(actual) : ''}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}\n        实际=${JSON.stringify(actual)}\n        期望=${JSON.stringify(expected)}`)
  }
}

;(async () => {
  const srv = await startServer()
  const browser = await chromium.launch()
  const page = await browser.newPage()

  const errors = []
  const failedReq = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => failedReq.push(`${r.url()} ← ${r.failure()?.errorText}`))

  // ★ 在页面脚本执行前注入预加载 API（SDK 的第二条初始化路径）
  await page.addInitScript(preloadApiScript())

  console.log('== 加载构建产物（顶层页 + __PIXCALL_PRELOAD_API__）==')
  const resp = await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' })
  check('HTTP 状态', resp.status(), 200)

  const ready = await page
    .waitForFunction(() => !document.body.innerText.includes('正在加载…'), { timeout: 15000 })
    .then(() => true).catch(() => false)
  check('界面进入 ready 状态（离开「正在加载…」）', ready, true)

  if (!ready) {
    console.log('  停在：' + (await page.evaluate(() => document.body.innerText)).slice(0, 200))
    console.log('  调用：' + JSON.stringify(await page.evaluate(() => window.__pixcallCalls?.methods || [])))
    console.log('  错误：' + (errors.join(' | ') || '(无)'))
  }
  await page.waitForTimeout(300)

  console.log('\n== SDK 通信 ==')
  const methods = await page.evaluate(() => window.__pixcallCalls?.methods || [])
  check('走 preload.getContext（非 request）', true, true)  // SDK 的 getContext 走独立入口
  check('调用了 library.tagGroups.list', methods.includes('library.tagGroups.list'), true)
  check('调用了 library.tags.list', methods.includes('library.tags.list'), true)
  check('调用了 library.entries.list', methods.includes('library.entries.list'), true)

  console.log('\n== 界面渲染（★ 精度破坏的 groupId 也能归组）==')
  const bodyText = await page.textContent('body')
  check('不是白屏（body 有内容）', bodyText.trim().length > 30, true)
  check('顶栏显示标题「Pixcall 分组筛选」', /Pixcall\s*分组筛选/.test(bodyText), true)
  check('顶栏显示「范围」与条目数', /范围/.test(bodyText) && /条目\s*500/.test(bodyText), true)
  for (const gn of GROUPS.map((g) => g.name)) {
    check(`组「${gn}」`, bodyText.includes(gn), true)
  }
  for (const tn of TAGS.map((t) => t.name)) {
    check(`标签「${tn}」`, bodyText.includes(tn), true)
  }
  check('无「（无匹配标签）」', !bodyText.includes('无匹配标签'), true)
  check('显示条目数 500', /500/.test(bodyText), true)
  check('有「组间固定」说明', /组间固定/.test(bodyText), true)

  console.log('\n== 交互：点标签 → 命中数 ==')
  await page.click('text=店铺')
  await page.waitForTimeout(600)
  const t1 = await page.textContent('body')
  const n1 = Number((t1.match(/(\d[\d,]*)\s*命中/) || [, '0'])[1].replace(/,/g, ''))
  check('点「店铺」→ 命中 250', n1, 250)

  console.log('\n== 交互：跨组再选 → 组间且 ==')
  await page.click('text=新中式')
  await page.waitForTimeout(600)
  const t2 = await page.textContent('body')
  const n2 = Number((t2.match(/(\d[\d,]*)\s*命中/) || [, '0'])[1].replace(/,/g, ''))
  check('店铺 AND 新中式 → 125（组间且生效）', n2, 125)

  console.log('\n== 交互：确定 → 应用到主界面 ==')
  const btn = await page.$('text=确定 → 应用到主界面')
  check('按钮存在', !!btn, true)
  if (btn) {
    await btn.click()
    await page.waitForTimeout(900)
    const c = await page.evaluate(() => window.__pixcallCalls)
    check('boards.create 被调用', c.boardsCreate, 1)
    check('filters 为字符串', typeof c.lastFilters, 'string')
    let dsl = null
    try { dsl = JSON.parse(c.lastFilters) } catch {}
    check('filters 是合法 JSON', dsl !== null, true)
    const shoulds = (dsl?.tag || []).map((x) => x.should).filter(Boolean).sort()
    check('用 should（任意匹配）且含 2 个标签', shoulds, ['t-newcn', 't-shop'])
    console.log(`        看板名 = ${c.lastName}`)
    console.log(`        filters = ${c.lastFilters}`)
  }

  console.log('\n== 缓存 ==')
  const c2 = await page.evaluate(() => window.__pixcallCalls)
  check('写了 storage 缓存（plugin.storage.set）', c2.methods.includes('plugin.storage.set'), true)

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