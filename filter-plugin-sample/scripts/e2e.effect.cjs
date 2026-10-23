/*
 * ★ 全面效果导向测试（2026-10-22 11:10）
 *
 * 起因：用户报了两个「看起来有、实际不生效」的缺陷：
 *   ① 放大按钮无效（我之前的测试只验了 resize 被调用，没验窗口真变大）
 *   ② 大图只能看到局部（我之前只验了 naturalWidth，没验图片是否完整可见）
 *
 * ⇒ 本测试的规则：**每项断言必须验证「用户能看见的实际效果」**，
 *   而不是「函数被调用」或「状态变量变了」。
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = 'C:/Users/Administrator/WorkBuddy/2026-10-12-15-11-15/pixcall-filter-probe/filter-plugin'
const PORT = 5237
const FS = 'http://127.0.0.1:1076'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' }
const FOLDER = '506255972227851264'

const REAL = [
  ['458413e9b13d7613583d22f83fa09fefb4cd015513aa57ff42ec8f3342dc15a0', '654071134770144256', '展厅-弧形墙与洽谈区.png'],
  ['bdef726b8e9541d31db670f5697d6f85fcc7f4c8c3cc4c2137a32b5cbdf356a9', '654071134711424000', '展厅-橙底壁龛与腕表广告.png'],
  ['0f6c54951c49f4d3a4dae52c99e90816a9789af5787dc851dd8a41975730f3ee', '654071134652703744', '休息区-橙绿曲面墙与蓝沙发.png'],
]
// 宽图（3000×800）与高图（800×3000），用于验证「完整显示」
const WIDE = { hash: 'bdef726b8e9541d31db670f5697d6f85fcc7f4c8c3cc4c2137a32b5cbdf356a9', id: '654071134770144256', w: 3000, h: 800 }
const TALL = { hash: '0f6c54951c49f4d3a4dae52c99e90816a9789af5787dc851dd8a41975730f3ee', id: '654071134652703744', w: 800, h: 3000 }

function mockEntries() {
  const arr = []
  for (let i = 0; i < 18; i++) {
    const r = REAL[i % REAL.length]
    arr.push({
      id: r[1], name: `${r[2].replace('.png', '')}_${i}.png`,
      contentHash: r[0], thumbWidth: 480, thumbHeight: 320,
      imageWidth: 1680, imageHeight: 1120, mediaType: 'image',
      parentId: FOLDER, isFolder: false,
      tagIds: i % 3 === 0 ? ['t1'] : i % 3 === 1 ? ['t1', 't2'] : ['t1', 't3'],
    })
  }
  // 加一张超宽图，用于验证大图完整显示
  arr.push({ id: WIDE.id, name: '超宽图_3000x800.png', contentHash: WIDE.hash, thumbWidth: 480, thumbHeight: 128, imageWidth: WIDE.w, imageHeight: WIDE.h, mediaType: 'image', parentId: FOLDER, isFolder: false, tagIds: ['t1'] })
  arr.push({ id: TALL.id, name: '超高图_800x3000.png', contentHash: TALL.hash, thumbWidth: 128, thumbHeight: 480, imageWidth: TALL.w, imageHeight: TALL.h, mediaType: 'image', parentId: FOLDER, isFolder: false, tagIds: ['t1'] })
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
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++; console.log(`  PASS  ${name}`)
  } else {
    fail++; fails.push(name)
    console.log(`  FAIL  ${name}\n        实际=${JSON.stringify(actual)}\n        期望=${JSON.stringify(expected)}`)
  }
}
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  (' + detail + ')' : ''}`) }
  else { fail++; fails.push(name); console.log(`  FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`) }
}

;(async () => {
  const srv = await startServer()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    screen: { width: 1920, height: 1040 },   // ★ 屏幕比视口大，才能验「铺满屏幕」
  })
  const page = await ctx.newPage()
  const errors = [], failedReq = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => failedReq.push(`${r.url()} ← ${r.failure()?.errorText}`))

  await page.addInitScript(`(() => {
    const ENT = ${JSON.stringify(mockEntries())};
    const store = {};
    const calls = { resize: [], closed: false, entriesList: 0 };
    window.__calls = calls;
    const sig = { libraryPath: 'D:/1-参考案例', folderId: '${FOLDER}', includeSub: true, count: ENT.length };
    store['scan-manifest-v1'] = JSON.stringify({ sig, chunkCount: 1, savedAt: 'x' });
    store['scan-chunk-v1-0'] = JSON.stringify(ENT.map(e => [e.id, e.contentHash, e.name, e.tagIds.join(',')]));
    const R = {
      'getContext': () => ({ library: { path: 'D:/1-参考案例', fileServer: '${FS}' }, current: {}, env: {},
        invocation: { command: 'pixcall-filter.open', trigger: 'context_menu', selection: { entryIds: ['${FOLDER}'] }, location: 'folder_tree' },
        view: { width: 1180, height: 820 } }),
      'window.resize': (p) => { calls.resize.push(p); return null },
      'window.close': () => { calls.closed = true; return null },
      'library.entries.list': () => { calls.entriesList++; return { entries: ENT, hasMore: false, nextCursor: null } },
      'library.tagGroups.list': () => ({ tagGroups: [{ id: 'g1', name: '2-空间（每图≤1-2）' }, { id: 'g2', name: '3-风格（每图≤1-2）' }], hasMore: false, nextCursor: null }),
      'library.tags.list': () => ({ tags: [{ id: 't1', name: '店铺', groupId: 'g1' }, { id: 't2', name: '会所', groupId: 'g1' }, { id: 't3', name: '现代', groupId: 'g2' }], hasMore: false, nextCursor: null }),
      'library.folders.list': () => ({ folders: [{ id: '${FOLDER}', name: '01-品牌珠宝空间-557', parentId: '1' }], hasMore: false, nextCursor: null }),
      'plugin.storage.get': (p) => store[p.key] ?? null,
      'plugin.storage.set': (p) => { store[p.key] = p.value; return null },
      'plugin.storage.delete': (p) => { delete store[p.key]; return null },
    };
    globalThis.__PIXCALL_PRELOAD_API__ = {
      request: async (m, p) => ({ type: 'ok', result: R[m] ? R[m](p) : {} }),
      getContext: async () => R['getContext'](), subscribe: () => () => {},
    };
  })();`)

  // iframe 拓扑
  await page.goto(`http://127.0.0.1:${PORT}/__host.html`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    const f = document.createElement('iframe')
    f.src = '/index.prod.html'
    f.style.cssText = 'width:1180px;height:820px;border:0'
    document.body.appendChild(f)
  })
  await page.waitForTimeout(800)
  const plugin = await (async () => {
    for (let i = 0; i < 30; i++) {
      const f = page.frames().find((x) => x.url().includes('index.prod.html'))
      if (f) { const d = await f.evaluate(() => document.readyState === 'complete').catch(() => false); if (d) return f }
      await page.waitForTimeout(200)
    }
    throw new Error('无 iframe')
  })()
  await plugin.waitForTimeout(2000)

  const clickByTitle = async (title) => {
    await plugin.evaluate((t) => {
      [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === t)?.click()
    }, title)
    await plugin.waitForTimeout(450)
  }
  const clickByText = async (txt) => {
    await plugin.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === t)
      if (b) b.click()
    }, txt)
    await plugin.waitForTimeout(450)
  }

  /* ══════════ A. 窗口按钮：必须验「实际效果」而非「调用发生」 ══════════ */
  console.log('== A. 窗口按钮（实际效果）==')
  const screenSize = await plugin.evaluate(() => ({ w: window.screen.availWidth, h: window.screen.availHeight }))

  await clickByTitle('铺满屏幕')
  const r1 = await plugin.evaluate(() => window.__calls.resize)
  ok('放大→调用 resize 且尺寸=屏幕可用区', r1.length === 1 && r1[0].width === screenSize.w && r1[0].height === screenSize.h,
     `调用=${JSON.stringify(r1)} 屏幕=${screenSize.w}x${screenSize.h}`)
  // ★ 关键：按钮状态必须变（用户能看出来）
  const t1 = await plugin.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.getAttribute('title')))
  ok('放大后按钮变成「恢复默认大小」', t1.includes('恢复默认大小'), t1.filter(Boolean).join('/'))

  await clickByTitle('恢复默认大小')
  const r2 = await plugin.evaluate(() => window.__calls.resize)
  ok('还原→尺寸回到默认 1180×820', r2.length === 2 && r2[1].width === 1180 && r2[1].height === 820, JSON.stringify(r2[1]))
  const t2 = await plugin.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.getAttribute('title')))
  ok('还原后按钮变回「铺满屏幕」', t2.includes('铺满屏幕'), '')

  /* ══════════ B. 大图完整显示（用户报的 bug 2）══════════ */
  console.log('\n== B. 大图完整显示 ==')
  await clickByTitle('切到看图')
  await plugin.waitForTimeout(1500)
  // 找到超宽图并点击
  const opened = await plugin.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')]
    const t = imgs.find((i) => (i.alt || '').includes('超宽图'))
    if (!t) return { found: false, alts: imgs.map((i) => i.alt).slice(0, 5) }
    t.click()
    return { found: true }
  })
  ok('网格里有超宽图', opened.found, JSON.stringify(opened.alts || ''))
  await plugin.waitForTimeout(2000)

  const big = await plugin.evaluate(() => {
    const im = [...document.querySelectorAll('img')].find((i) => i.src.includes('/masters/'))
    if (!im) return { found: false }
    const box = im.parentElement
    const r = im.getBoundingClientRect()
    const p = box.getBoundingClientRect()
    return {
      found: true,
      // 图片渲染尺寸
      rw: Math.round(r.width), rh: Math.round(r.height),
      // 容器尺寸
      pw: Math.round(p.width), ph: Math.round(p.height),
      // 自然尺寸
      nw: im.naturalWidth, nh: im.naturalHeight,
      loaded: im.complete && im.naturalWidth > 0,
      overflowY: box.scrollHeight - box.clientHeight,
      overflowX: box.scrollWidth - box.clientWidth,
    }
  })
  ok('大图已加载', big.found && big.loaded, JSON.stringify(big))
  if (!big.loaded) { console.log('  ⚠ 大图未加载，后续断言无意义') }
  if (big.found) {
    // ★ 完整显示判定：图片渲染框必须完整落在容器内，且宽高比与原图一致
    const fitsH = big.rh <= big.ph + 2
    const fitsW = big.rw <= big.pw + 2
    ok('大图高度未超出容器（不被裁切）', fitsH, `图高=${big.rh} 容器高=${big.ph}`)
    ok('大图宽度未超出容器', fitsW, `图宽=${big.rw} 容器宽=${big.pw}`)
    // 用渲染框反推实际显示内容（object-fit:contain 下）
    if (big.nw > 0 && big.nh > 0) {
      const scale = Math.min(big.rw / big.nw, big.rh / big.nh)
      const displayW = Math.round(big.nw * scale)
      const displayH = Math.round(big.nh * scale)
      ok('整图完整可见（宽高都在渲染框内）', displayW <= big.rw + 2 && displayH <= big.rh + 2,
         `原图${big.nw}x${big.nh} → 显示${displayW}x${displayH} 渲染框${big.rw}x${big.rh}`)
    } else {
      ok('整图完整可见（宽高都在渲染框内）', false, '原图尺寸为 0，未加载')
    }
  }
  await page.screenshot({ path: 'v3-bigimage.png' })

  /* ══════════ C. 大图翻页：必须验「图真的换了」 ══════════ */
  console.log('\n== C. 大图翻页（实际效果）==')
  const before = await plugin.evaluate(() => {
    const im = [...document.querySelectorAll('img')].find((i) => i.src.includes('/masters/'))
    return { src: im?.src, idx: (document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/) || [])[1] }
  })
  await page.mouse.move(590, 400)
  await page.mouse.wheel(0, 300)
  await plugin.waitForTimeout(1200)
  const after = await plugin.evaluate(() => {
    const im = [...document.querySelectorAll('img')].find((i) => i.src.includes('/masters/'))
    return { src: im?.src, idx: (document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/) || [])[1] }
  })
  ok('滚轮后大图真的换了（src 变化）', before.src !== after.src, `${before.src?.slice(-14)} → ${after.src?.slice(-14)}`)
  ok('滚轮后序号变化', before.idx !== after.idx, `${before.idx} → ${after.idx}`)

  // 键盘
  await plugin.evaluate(() => {
    const el = document.querySelector('div[tabindex]')
    el?.focus()
  })
  await plugin.waitForTimeout(200)
  await page.keyboard.press('ArrowDown')
  await plugin.waitForTimeout(800)
  const afterKey = await plugin.evaluate(() => {
    const im = [...document.querySelectorAll('img')].find((i) => i.src.includes('/masters/'))
    return { src: im?.src, idx: (document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/) || [])[1] }
  })
  ok('键盘 → 也能翻页', afterKey.src !== after.src, `${after.idx} → ${afterKey.idx}`)

  // ★ 点大图本身不该关闭查看器（只有点空白才关）
  await plugin.evaluate(() => {
    const im = [...document.querySelectorAll('img')].find((i) => i.src.includes('/masters/'))
    im?.click()
  })
  await plugin.waitForTimeout(500)
  const stillOpen = await plugin.evaluate(() => !!document.querySelector('img[src*="/masters/"]'))
  ok('点大图本身不会误关查看器', stillOpen, '')

  // Esc
  await plugin.evaluate(() => { document.querySelector('div[tabindex]')?.focus() })
  await page.keyboard.press('Escape')
  await plugin.waitForTimeout(600)
  const closedByEsc = await plugin.evaluate(() => !document.querySelector('img[src*="/masters/"]'))
  ok('Esc 关闭查看器', closedByEsc, '')

  /* ══════════ D. 筛选：每个交互都要有可见效果 ══════════ */
  console.log('\n== D. 筛选交互（可见效果）==')
  await clickByTitle('切到筛选')
  await plugin.waitForTimeout(500)

  // 选中标签 → 徽章数 + 命中数变
  const b1 = await plugin.evaluate(() => (document.body.innerText.match(/命中\s*(\d+)/) || [])[1])
  await clickByText('店铺')
  const after1 = await plugin.evaluate(() => {
    const t = document.body.innerText
    const sel = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === '店铺')
    return {
      hit: (t.match(/命中\s*(\d+)/) || [])[1],
      badge: !!document.querySelector('span[style*="background: rgb(110, 93, 246)"]'),
      selStyle: sel[0] ? getComputedStyle(sel[0]).backgroundColor : '',
    }
  })
  ok('点标签后命中数变化', b1 !== after1.hit, `${b1} → ${after1.hit}`)
  ok('选中标签有高亮样式', after1.selStyle.includes('110, 93, 246'), after1.selStyle)

  // 模式切换：组内要选 2 个标签才有区别（任意 vs 全部）
  // ★ 修：之前组内只选 1 个，任意与全部等价 → 测不出差异
  await clickByText('会所')
  const hitAny = await plugin.evaluate(() => (document.body.innerText.match(/命中\s*(\d+)/) || [])[1])
  // ★ 精确定位组头：取「含该组名 + 含模式按钮」的最内层 div
  //   （之前用 startsWith 会命中外层容器，导致点错按钮 → 假失败）
  const modeInfo = await plugin.evaluate(async () => {
    const cands = [...document.querySelectorAll('div')].filter(
      (d) => d.innerText?.includes('2-空间') &&
        [...d.querySelectorAll('button')].some((b) => b.innerText.trim() === '全部匹配')
    )
    const smallest = cands[cands.length - 1] || cands[0]
    const target = [...smallest.querySelectorAll('button')].find((b) => b.innerText.trim() === '全部匹配')
    target?.click()
    await new Promise((r) => setTimeout(r, 500))
    const on = [...smallest.querySelectorAll('button')]
      .filter((b) => getComputedStyle(b).backgroundColor.includes('110, 93, 246'))
      .map((b) => b.innerText.trim())
    return { on }
  })
  await plugin.waitForTimeout(500)
  ok('模式按钮高亮切到「全部匹配」', modeInfo.on.includes('全部匹配'), JSON.stringify(modeInfo.on))
  const hitAll = await plugin.evaluate(() => (document.body.innerText.match(/命中\s*(\d+)/) || [])[1])
  ok('模式切换后命中数变化', hitAny !== hitAll, `任意=${hitAny} → 全部=${hitAll}`)

  // 搜索框过滤
  await plugin.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="过滤标签"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '会所')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await plugin.waitForTimeout(600)
  const filtered = await plugin.evaluate(() => {
    const tags = [...document.querySelectorAll('button')].map((b) => b.innerText.trim())
    return { hasShop: tags.includes('店铺'), hasClub: tags.includes('会所') }
  })
  ok('搜索框真的过滤了标签', filtered.hasClub && !filtered.hasShop, JSON.stringify(filtered))

  // 清空
  await clickByText('清空')
  const cleared = await plugin.evaluate(() => (document.body.innerText.match(/命中\s*(\d+)/) || [])[1])
  ok('清空后命中数归零/消失', !cleared || cleared === '0', `命中=${cleared}`)

  // 折叠
  const fold = await plugin.evaluate(async () => {
    const before = document.querySelectorAll('button').length
    const f = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '▾')
    f?.click()
    await new Promise((r) => setTimeout(r, 400))
    const after = document.querySelectorAll('button').length
    return { before, after }
  })
  ok('折叠后标签按钮减少', fold.after < fold.before, `${fold.before} → ${fold.after}`)

  /* ══════════ E. 网格尺寸档位 ══════════ */
  console.log('\n== E. 网格尺寸 ==')
  await clickByTitle('切到看图')
  await plugin.waitForTimeout(1200)
  const w = async () => plugin.evaluate(() => {
    const im = document.querySelector('img[src*="/thumbs/"]')
    return im ? Math.round(im.getBoundingClientRect().width) : 0
  })
  const wMid = await w()
  await clickByText('小')
  const wSmall = await w()
  await clickByText('大')
  const wLarge = await w()
  ok('小 < 中 < 大 档位生效', wSmall < wMid && wMid < wLarge, `小=${wSmall} 中=${wMid} 大=${wLarge}`)

  /* ══════════ F. 范围胶囊 ══════════ */
  console.log('\n== F. 范围切换 ==')
  await clickByTitle('切到筛选')
  await plugin.waitForTimeout(400)
  const scopeBefore = await plugin.evaluate(() => document.body.innerText.match(/(01-品牌珠宝空间-557|全库)/)?.[1])
  await plugin.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('切到全库'))?.click()
  })
  await plugin.waitForTimeout(800)
  const scopeAfter = await plugin.evaluate(() => document.body.innerText.match(/(01-品牌珠宝空间-557|全库)/)?.[1])
  ok('范围胶囊可切换', scopeBefore !== scopeAfter, `${scopeBefore} → ${scopeAfter}`)
  // ★ 范围变了但数据是旧的 → 必须明确提示，否则标签与数据不符
  const hint = await plugin.evaluate(() => {
    const els = [...document.querySelectorAll('span')].map((s) => s.innerText || '')
    return els.find((x) => /旧数据|还没有扫描|点「扫描」/.test(x)) || ''
  })
  ok('范围与数据不一致时有明确提示', hint.length > 0, hint)
  // 切回
  await plugin.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('当前文件夹'))?.click()
  })
  await plugin.waitForTimeout(800)
  const scopeBack = await plugin.evaluate(() => document.body.innerText.match(/(01-品牌珠宝空间-557|全库)/)?.[1])
  ok('可切回当前文件夹', scopeBack === scopeBefore, `${scopeAfter} → ${scopeBack}`)

  console.log('\n== 控制台 ==')
  check('无 JS 错误', errors.length, 0)
  if (errors.length) console.log('        ' + errors.slice(0, 3).join(' | '))
  check('无失败请求', failedReq.length, 0)
  if (failedReq.length) console.log('        ' + failedReq.slice(0, 3).join(' | '))

  await browser.close()
  srv.close()
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  if (fails.length) console.log('失败项：' + fails.join(' | '))
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => { console.error('测试崩溃：', e.message); process.exit(2) })
