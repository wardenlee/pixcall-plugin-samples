/*
 * 缓存命中逻辑验证（不依赖 SDK，纯函数模拟）
 *
 * 针对用户 23:03 反馈「每次打开都重建索引」——
 * 根因是签名比对里 entryCount 用了 -1，而比对要求三项全等 → 永不命中。
 * 本脚本证明 loadCacheFlexible 的判定规则是对的。
 */

type Signature = { libraryPath: string; tagCount: number; entryCount: number }

function shouldHit(saved: Signature, probe: Signature): boolean {
  // loadCacheFlexible 的判定规则（保持与实现一致）
  if (saved.libraryPath !== probe.libraryPath) return false
  if (saved.tagCount !== probe.tagCount) return false
  if (probe.entryCount >= 0 && saved.entryCount !== probe.entryCount) return false
  return true
}

let pass = 0
let fail = 0
function check(name: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}（实际=${actual}，期望=${expected}）`)
  }
}

const saved: Signature = { libraryPath: 'D:\\1-参考案例', tagCount: 138, entryCount: 27178 }
const probeNoCount: Signature = { libraryPath: 'D:\\1-参考案例', tagCount: 138, entryCount: -1 }

console.log('== 核心：开窗探测（不比对条目数）应命中 ==')
check('同库同标签数 → 命中', shouldHit(saved, probeNoCount), true)

console.log('\n== 换了库 → 必须重建 ==')
check(
  '不同库路径 → 不命中',
  shouldHit(saved, { libraryPath: 'D:\\别的库', tagCount: 138, entryCount: -1 }),
  false,
)

console.log('\n== 标签数变了 → 必须重建 ==')
check('标签数不同 → 不命中', shouldHit(saved, { ...probeNoCount, tagCount: 140 }), false)

console.log('\n== 严格比对模式（显式给条目数）==')
check('条目数相同 → 命中', shouldHit(saved, { ...probeNoCount, entryCount: 27178 }), true)
check('条目数不同 → 不命中', shouldHit(saved, { ...probeNoCount, entryCount: 30000 }), false)

console.log('\n== 对照：旧逻辑（要求三项全等）==')
function oldShouldHit(s: Signature, p: Signature): boolean {
  return s.libraryPath === p.libraryPath && s.tagCount === p.tagCount && s.entryCount === p.entryCount
}
check('旧逻辑 + entryCount:-1 → 不命中（这正是每��重建的根因）', oldShouldHit(saved, probeNoCount), false)
check('新逻辑 + entryCount:-1 → 命中（本次修复）', shouldHit(saved, probeNoCount), true)

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
if (fail > 0) process.exit(1)
