/*
 * 范围裁剪逻辑验证 —— 不依赖 SDK，纯函数模拟
 *
 * 验证「筛选源 = 当前文件夹」的核心逻辑：
 *   · 仅本层
 *   · 含子文件夹（递归）
 */

import type { IndexEntry } from '../src/lib/filterLogic.ts'

/**
 * 这里复制 filterCore.scopeToFolder 的实现来测（Node 无法直接 import，
 * 因为 filterCore 内部 import filterLogic 时缺 .ts 扩展名 —— Vite 能解析，Node 不能）。
 * 逻辑与实现保持一致；若改 filterCore 请同步改这里。
 */
function scopeToFolder(
  all: IndexEntry[],
  folderId: string,
  allFolders: { id: string; parentId: string }[],
  includeSub: boolean,
): IndexEntry[] {
  if (!includeSub) return all.filter((e) => !e.isFolder && e.parentId === folderId)
  const byParent = new Map<string, string[]>()
  for (const f of allFolders) {
    const list = byParent.get(f.parentId)
    if (list) list.push(f.id)
    else byParent.set(f.parentId, [f.id])
  }
  const scope = new Set<string>([folderId])
  const queue = [folderId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const child of byParent.get(cur) ?? []) {
      if (!scope.has(child)) {
        scope.add(child)
        queue.push(child)
      }
    }
  }
  return all.filter((e) => !e.isFolder && scope.has(e.parentId ?? ''))
}

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

const E = (id: string, parentId: string, isFolder = false): IndexEntry => ({
  id,
  name: id,
  tagIds: [],
  parentId,
  isFolder,
})

// 文件夹树：root → A → A1 → A1a；root → B
const entries: IndexEntry[] = [
  E('F1', 'A'), // 在 A 下
  E('F2', 'A'),
  E('F3', 'A1'), // 在 A 的子文件夹 A1 下
  E('F4', 'A1a'), // 在 A1 的子文件夹 A1a 下
  E('F5', 'B'), // 在 B 下
  E('F6', 'root'), // 在根下
  E('A', 'root', true),
  E('A1', 'A', true),
  E('A1a', 'A1', true),
  E('B', 'root', true),
]

const folders = entries.filter((e) => e.isFolder).map((e) => ({ id: e.id, parentId: e.parentId ?? '' }))

console.log('== 仅本层（A，不含子文件夹）==')
const onlyA = scopeToFolder(entries, 'A', folders, false)
check('仅 A 本层的条目数', onlyA.length, 2)
check('不含子文件夹的条目', onlyA.map((e) => e.id).sort().join(','), 'F1,F2')

console.log('\n== 含子文件夹（A + A1 + A1a，递归）==')
const withSub = scopeToFolder(entries, 'A', folders, true)
check('含所有层级的条目数', withSub.length, 4)
check('含子文件夹的条目', withSub.map((e) => e.id).sort().join(','), 'F1,F2,F3,F4')

console.log('\n== 文件夹本身不应出现在结果里 ==')
check('结果里不含文件夹', withSub.some((e) => e.isFolder), false)

console.log('\n== 深层嵌套 ==')
const deep = scopeToFolder(entries, 'A1', folders, true)
check('A1 含 A1a 的条目', deep.map((e) => e.id).sort().join(','), 'F3,F4')

console.log('\n== 根目录（root）==')
const root = scopeToFolder(entries, 'root', folders, false)
check('root 本层', root.map((e) => e.id).sort().join(','), 'F6')

const rootAll = scopeToFolder(entries, 'root', folders, true)
check('root 含所有子文件夹（应等于全部 6 个文件）', rootAll.length, 6)

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
if (fail > 0) process.exit(1)
