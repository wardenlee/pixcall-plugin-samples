/*
 * ★ 4 个问题的验证（2026-10-22 15:30）
 *
 * 核心（问题1）：模拟「扫描 → 关掉 → 再打开」，必须**不重新扫描**就能用。
 *   → storage 放在父页面，reload iframe 后仍然存在（真实模拟关闭重开）
 *
 * 其余：窗口按钮三级降级 / 查看器有窗口按钮 / 文件夹跟随轮询
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const ROOT = 'C:/Users/Administrator/WorkBuddy/2026-10-12-15-11-15/pixcall-filter-probe/filter-plugin'
const PORT = 5239
const FS = 'http://127.0.0.1:1099'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' }

const F1 = '506255972227851264' // 01-品牌珠宝空间-557
const F2 = '641492984815133696' // 另一个文件夹
const HASH = '458413e9b13d7613583d22f83fa09fefb4cd015513aa57ff42ec8f3342dc15a0'

/** 造 3000 条（跨两个文件夹），用于测分片与跨文件夹复用 */
function mockEntries() {
  const arr = []
  for (let i = 0; i < 3000; i++) {
    const folder = i % 3 === 0 ? F2 : F1
    arr.push({
      id: '65500000000000' + String(i).padStart(4, '0'),
      name: `图_${i}.png`,
      contentHash: HASH,
      thumbWidth: 480, thumbHeight: 320,
      imageWidth: 1680, imageHeight: 1120,
      mediaType: 'image',
      parentId: folder,
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
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), `实际=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`) }

const PRELOAD = (entriesJson, currentFolder) => `(() => {
  // ★ storage 放在父页面 → iframe reload 后仍存在，真实模拟「关闭再打开」
  const host = window.parent !== window ? window.parent : window;
  if (!host.__store) host.__store = {};
  const store = host.__store;
  if (!host.__calls) host.__calls = { entriesList: 0, resize: [], resizeTo: [], closed: 0 };
  const calls = host.__calls;

  const ENT = ${entriesJson};
  const R = {
    'getContext': () => ({
      library: { path: 'D:/1-参考案例', fileServer: '${FS}' },
      current: {}, env: {},
      invocation: { command: 'pixcall-filter.open', trigger: 'context_menu',
        selection: { entryIds: [host.__curFolder || '${currentFolder}'] }, location: 'folder_tree' },
      view: { width: 1180, height: 820 },
    }),
    'window.resize': (p) => {
      // ★ 真实环境是顶层窗口 → 抛错（复现用户报的错）
      if (window.parent === window) throw new Error('window.resize is only available in iframe plugins');
      calls.resize.push(p); return null;
    },
    'window.close': () => { calls.closed++; return null },
    'library.entries.list': () => { calls.entriesList++; return { entries: ENT, hasMore: false, nextCursor: null } },
    'library.tagGroups.list': () => ({ tagGroups: [{ id: 'g1', name: '2-空间（每图≤1-2）' }], hasMore: false, nextCursor: null }),
    'library.tags.list': () => ({ tags: [{ id: 't1', name: '店铺', groupId: 'g1' }, { id: 't2', name: '会所', groupId: 'g1' }], hasMore: false, nextCursor: null }),
    'library.folders.list': () => ({ folders: [
      { id: '${F1}', name: '01-品牌珠宝空间-557', parentId: '1' },
      { id: '${F2}', name: '02-同业珠宝空间-312', parentId: '1' },
    ], hasMore: false, nextCursor: null }),
    'plugin.storage.get': (p) => store[p.key] ?? null,
    'plugin.storage.set': (p) => { store[p.key] = p.value; return null },
    'plugin.storage.delete': (p) => { delete store[p.key]; return null },
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
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, screen: { width: 1920, height: 1040 } })
  const page = await ctx.newPage()
  const errors = [], failedReq = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => failedReq.push(`${r.url()} ← ${r.failure()?.errorText}`))

  const entries = mockEntries()

  // ★ 必须用 addInitScript —— 它会注入到**所有 frame**（含 iframe）；
  //   page.evaluate 只注入父页面，iframe 里就拿不到 __PIXCALL_PRELOAD_API__（卡在「正在加载」）。
  //   store 挂在父页面 → iframe reload 后仍在（真实模拟「关掉再打开」）。
  await page.addInitScript(PRELOAD(JSON.stringify(entries), F1))
  await page.goto(`http://127.0.0.1:${PORT}/__host.html`, { waitUntil: 'networkidle' })

  const openPlugin = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('iframe').forEach((f) => f.remove())
      const f = document.createElement('iframe')
      f.src = '/index.prod.html?v=' + Date.now()
      f.style.cssText = 'width:1180px;height:820px;border:0'
      document.body.appendChild(f)
    })
    await page.waitForTimeout(900)
    for (let i = 0; i < 40; i++) {
      const f = page.frames().find((x) => x.url().includes('index.prod.html'))
      if (f) {
        const d = await f.evaluate(() => document.readyState === 'complete').catch(() => false)
        if (d) { await f.waitForTimeout(1800); return f }
      }
      await page.waitForTimeout(200)
    }
    throw new Error('无 iframe')
  }

  const clickByText = async (fr, txt) => {
    await fr.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === t)
      if (b) b.click()
    }, txt)
    await fr.waitForTimeout(450)
  }
  const clickByTitle = async (fr, title) => {
    await fr.evaluate((t) => {
      [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === t)?.click()
    }, title)
    await fr.waitForTimeout(450)
  }

  /* ═══════ 第一次打开：应提示未扫描 ═══════ */
  console.log('== 第一次打开 ==')
  let fr = await openPlugin()
  let body = await fr.textContent('body')
  ok('首次打开提示需要扫描', /尚未扫描|缓存不完整/.test(body), (body.match(/(尚未扫描|缓存不完整)[^\n]{0,30}/) || [])[0] || body.slice(0,120))
  eq('首次没有缓存，entries.list 未调用', await fr.evaluate(() => window.parent.__calls.entriesList), 0)

  /* ═══════ 扫描 → 保存 ═══════ */
  console.log('\n== 扫描 3000 条 + 保存缓存 ==')
  await clickByText(fr, '扫描')
  await fr.waitForTimeout(4000)
  const afterScan = await fr.evaluate(() => ({
    list: window.parent.__calls.entriesList,
    text: document.body.innerText,
    keys: Object.keys(window.parent.__store || {}),
  }))
  ok('条目已扫描（entries.list 被调用）', afterScan.list > 0, `调用 ${afterScan.list} 次`)
  ok('界面显示缓存信息', /缓存\s*3,?000\s*条/.test(afterScan.text), (afterScan.text.match(/缓存[^\n]{0,60}/) || [])[0])
  const chunkKeys = afterScan.keys.filter((k) => k.startsWith('scan2-c'))
  ok('已写入分片（3000/500=6 片）', chunkKeys.length === 6, `实际 ${chunkKeys.length} 片`)
  ok('已写入 manifest', afterScan.keys.includes('scan2-manifest'), '')
  const totalBytes = await fr.evaluate(() => {
    const s = window.parent.__store || {}
    return Object.values(s).reduce((n, v) => n + (v ? v.length : 0), 0)
  })
  console.log(`        缓存总字节：${(totalBytes / 1048576).toFixed(2)} MB`)

  /* ═══════ ★★★ 关掉再打开：核心验证 ═══════ */
  console.log('\n== ★ 关掉 → 再打开（核心）==')
  await page.evaluate(() => { window.__calls.entriesList = 0 })
  fr = await openPlugin()  // reload iframe = 模拟关闭重开
  const reopen = await fr.evaluate(() => ({
    list: window.parent.__calls.entriesList,
    text: document.body.innerText,
  }))
  ok('★ 重开后**没有重新扫描**', reopen.list === 0, `entries.list 调用 ${reopen.list} 次`)
  ok('★ 重开后自动载入缓存', /缓存\s*3,?000\s*条/.test(reopen.text), (reopen.text.match(/缓存[^\n]{0,60}/) || [])[0])
  ok('重开后不再提示「尚未扫描」', !/尚未扫描/.test(reopen.text), '')

  /* ═══════ 跨文件夹复用（范围裁剪） ═══════ */
  console.log('\n== 跨文件夹复用（换范围不重扫）==')
  const f1Count = entries.filter((e) => e.parentId === F1).length
  const f2Count = entries.filter((e) => e.parentId === F2).length
  const topCount = await fr.evaluate(() => {
    const m = document.body.innerText.match(/([\d,]+)\s*条/)
    return m ? Number(m[1].replace(/,/g, '')) : -1
  })
  ok('当前文件夹下条数正确（本地裁剪）', topCount === f1Count, `显示 ${topCount}，期望 ${f1Count}（全库 ${entries.length}）`)
  // 切全库
  await fr.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('切到全库'))?.click()
  })
  await fr.waitForTimeout(700)
  const allCount = await fr.evaluate(() => {
    const m = document.body.innerText.match(/([\d,]+)\s*条/)
    return m ? Number(m[1].replace(/,/g, '')) : -1
  })
  ok('切全库后条数=3000（无需重扫）', allCount === entries.length, `显示 ${allCount}`)
  eq('切全库未触发重扫', await fr.evaluate(() => window.parent.__calls.entriesList), 0)

  /* ═══════ 问题3：窗口缩放（顶层窗口 SDK 会抛错 → 应降级而不是弹错误） ═══════ */
  console.log('\n== 问题3：窗口按钮（顶层窗口降级）==')
  await clickByTitle(fr, '最大化（铺满屏幕）')
  const resizeState = await fr.evaluate(() => ({
    text: document.body.innerText,
    hasErrorToast: /窗口缩放失败|only available in iframe/.test(document.body.innerText),
  }))
  ok('不再显示「窗口缩放失败」原始错误', !resizeState.hasErrorToast,
     (resizeState.text.match(/当前环境不支持[^\n]{0,40}|已铺满[^\n]{0,10}/) || [])[0] || '')
  const winBtns = await fr.evaluate(() => [...document.querySelectorAll('header button')].map((b) => b.getAttribute('title')))
  ok('顶栏有 3 个窗口按钮（缩小/放大/关闭）',
     winBtns.some((t) => /还原为默认大小/.test(t || '')) &&
     winBtns.some((t) => /最大化|已经是最大化/.test(t || '')) &&
     winBtns.includes('关闭'),
     winBtns.filter(Boolean).join(' / '))

  /* ═══════ 问题4：看图时有窗口按钮 ═══════ */
  console.log('\n== 问题4：看图时有窗口按钮 ==')
  await clickByTitle(fr, '切到看图')
  await fr.waitForTimeout(1200)
  await fr.evaluate(() => {
    const im = document.querySelector('img[src*="/thumbs/"]')
    im?.click()
  })
  await fr.waitForTimeout(1600)
  const viewerBtns = await fr.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    return btns.map((b) => b.getAttribute('title')).filter(Boolean)
  })
  ok('查看器里有「还原为默认大小」', viewerBtns.includes('还原为默认大小'), '')
  ok('查看器里有「最大化」', viewerBtns.some((t) => /最大化/.test(t || '')), viewerBtns.filter((x) => /最大化/.test(x || '')).join(','))
  ok('查看器里有「关闭插件窗口」', viewerBtns.includes('关闭插件窗口'), '')
  ok('查看器里有「返回网格」', /返回网格/.test(await fr.textContent('body')), '')
  await page.screenshot({ path: 'v4-viewer-btns.png' })

  /* ═══════ 问题2：文件夹跟随（轮询） ═══════ */
  console.log('\n== 问题2：文件夹跟随轮询 ==')
  // 关闭查看器 → 切回筛选 → 在全库模式（轮询不跟随），先切回文件夹
  await fr.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '返回网格')?.click()
  })
  await fr.waitForTimeout(500)
  await clickByTitle(fr, '切到筛选')
  await fr.waitForTimeout(500)
  // 从全库切回文件夹（轮询只在非全库时生效）
  await fr.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').includes('当前文件夹'))?.click()
  })
  await fr.waitForTimeout(700)
  // 模拟主界面切换文件夹：改变 getContext 返回的 entryIds
  const followed = await fr.evaluate(async (f2) => {
    // 模拟「主界面切到另一个文件夹」：改宿主侧的当前文件夹变量
    window.parent.__curFolder = f2
    await new Promise((r) => setTimeout(r, 3200))   // 等一轮轮询（1.8s）
    return document.body.innerText
  }, F2)
  ok('轮询检测到文件夹变化并跟随', /02-同业珠宝空间-312/.test(followed),
     (followed.match(/(01-品牌珠宝空间-557|02-同业珠宝空间-312|全库)/) || [])[0] || '未变化')

  /* ═══════ 控制台 ═══════ */
  console.log('\n== 控制台 ==')
  ok('无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))
  // ★ 只校验缩略图请求（用真实 contentHash，应该全部成功）。
  //   原图 /masters/{假id} 必然 404 —— 是 mock 用了虚构 id 的预期行为，不算代码缺陷。
  const thumbFails = failedReq.filter((x) => x.includes('/thumbs/'))
  ok('缩略图请求全部成功', thumbFails.length === 0, thumbFails.slice(0, 2).join(' | '))

  await browser.close()
  srv.close()
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  if (fails.length) console.log('失败项：' + fails.join(' | '))
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => { console.error('测试崩溃：', e.message); process.exit(2) })
