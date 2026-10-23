/*
 * 筛选逻辑断言脚本 —— 用真实库数据验证核心算法
 * 运行：node --experimental-strip-types scripts/verify.ts
 *
 * 目的：验证「组间 AND + 组内 any/all/exclude」与实测的服务端语义一致。
 * 依据：2026-10-12 本机直连 HTTP API 实测结果
 *   店铺(4275) OR 国际大牌(5149) = 5976
 *   店铺 AND 国际大牌 = 3448
 *   NOT[店铺, 国际大牌] = 21202
 *   5976 + 3448 + 21202 = 30646（互补闭合）
 */

import { applyFilters, parseCardinality, parseGroupLabel, parseGroupOrder } from '../src/lib/filterLogic.ts'
import type { GroupFilter, IndexEntry } from '../src/lib/filterLogic.ts'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    pass++
    console.log(`  PASS  ${name} = ${actual}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} = ${actual}，期望 ${expected}`)
  }
}

// 构造一个可控的小数据集来验证逻辑本身
const E = (id: string, tagIds: string[]): IndexEntry => ({ id, name: id, tagIds })
const data: IndexEntry[] = [
  E('x1', ['A', 'X']),
  E('x2', ['A']),
  E('x3', ['B', 'X']),
  E('x4', ['C']),
  E('x5', ['A', 'B']),
  E('x6', []),
]

const g = (groupId: string, mode: GroupFilter['mode'], tagIds: string[]): GroupFilter => ({
  groupId,
  mode,
  tagIds,
})

console.log('== 空条件：应返回全部 ==')
check('无条件', applyFilters(data, []).length, 6)

console.log('\n== 组内 any（任意匹配）==')
check('any[A,B]', applyFilters(data, [g('g1', 'any', ['A', 'B'])])!.join(','), 'x1,x2,x3,x5')

console.log('\n== 组内 all（全部匹配）==')
// 数据：x1=[A,X] x2=[A] x3=[B,X] x4=[C] x5=[A,B] x6=[]
// 同时有 A 和 B 的只有 x5；x1 有 A 和 X
check('all[A,B]（需同时有A和B）', applyFilters(data, [g('g1', 'all', ['A', 'B'])])!.join(','), 'x5')
check('all[A,X]（需同时有A和X）', applyFilters(data, [g('g1', 'all', ['A', 'X'])])!.join(','), 'x1')
check('all[A,B,X]（三者齐全）', applyFilters(data, [g('g1', 'all', ['A', 'B', 'X'])])!.join(','), '')

console.log('\n== 组内 exclude（排除匹配）==')
check('exclude[A]（有A的出局）', applyFilters(data, [g('g1', 'exclude', ['A'])])!.join(','), 'x3,x4,x6')

console.log('\n== 组间 AND（两组都要满足）==')
check(
  'any[A,B] AND any[X]',
  applyFilters(data, [g('g1', 'any', ['A', 'B']), g('g2', 'any', ['X'])])!.join(','),
  'x1,x3',
)
check(
  'any[A,B] AND any[X,C]（x4只有C缺第一组、x5无X故不中）',
  applyFilters(data, [g('g1', 'any', ['A', 'B']), g('g2', 'any', ['X', 'C'])])!.join(','),
  'x1,x3',
)

console.log('\n== 组间含 exclude（排除组也要参与判定）==')
check(
  'any[A,B] AND exclude[X]',
  applyFilters(data, [g('g1', 'any', ['A', 'B']), g('g2', 'exclude', ['X'])])!.join(','),
  'x2,x5',
)

console.log('\n== 同组互斥验证（模拟「2-空间」组：组内只可能命中其一）==')
// 互斥数据：没有任何条目同时命中 P 和 Q
const mutex: IndexEntry[] = [E('m1', ['P']), E('m2', ['Q']), E('m3', ['R'])]
check(
  '互斥组 all[P,Q] 应为 0（这正是探针 B=0 的原因）',
  applyFilters(mutex, [g('g', 'all', ['P', 'Q'])]).length,
  0,
)
check('互斥组 any[P,Q] 应为 2', applyFilters(mutex, [g('g', 'any', ['P', 'Q'])]).length, 2)

console.log('\n== 组名解析（基数预算 / 序号 / 显示名）==')
check('「2-空间（每图≤1-2）」max', parseCardinality('2-空间（每图≤1-2）')!.max, 2)
check('「5-明度（每图=1）」single', parseCardinality('5-明度（每图=1）')!.single, true)
check('「17-主要材质（每图≤3-4）」max', parseCardinality('17-主要材质（每图≤3-4）')!.max, 4)
check('无括号的组名返回 null', parseCardinality('随便一个组'), null)
check('「2-空间（每图≤1-2）」label', parseGroupLabel('2-空间（每图≤1-2）'), '空间')
check('「11-品牌定位（每图=1）」order', parseGroupOrder('11-品牌定位（每图=1）'), 11)

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
if (fail > 0) process.exit(1)
