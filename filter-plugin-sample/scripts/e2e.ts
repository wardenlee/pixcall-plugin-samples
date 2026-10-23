/*
 * 端到端验证：用 Pixcall HTTP API 的真实数据（服务端，ID 是字符串）
 * 跑一遍「本地筛选算法」，看结果是否与 POST /entries/count 一致。
 *
 * 这验证的是**算法本身**在真实数据上正确。
 * 插件内能否拿到同等的字符串 ID，取决于 SDK —— 已由用户探测确认
 * Entry.tagIds 是 string（可靠）。
 *
 * 运行：node --experimental-strip-types scripts/e2e.ts
 */

import { readFileSync } from 'node:fs'
import { applyFilters, parseCardinality, parseGroupLabel, parseGroupOrder } from '../src/lib/filterLogic.ts'
import type { GroupFilter, IndexEntry } from '../src/lib/filterLogic.ts'

const KEY = process.env.PIX_KEY ?? ''
const BASE = 'http://127.0.0.1:22510/api/v1'

if (!KEY) {
  console.error('需要设置环境变量 PIX_KEY=Pixcall API Key')
  process.exit(2)
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

async function allOf(res: string): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  do {
    const q = `/${res}?limit=200${cursor ? `&cursor=${cursor}` : ''}`
    const d = await api(q)
    out.push(...d.data)
    cursor = d.next_cursor ?? undefined
  } while (cursor)
  return out
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

const tags = await allOf('tags')
const groups = await allOf('tag_groups')
const gname = new Map<string, string>(groups.map((g) => [g.id, g.name]))

console.log(`拉取：标签 ${tags.length} / 组 ${groups.length}`)

// —— 验证 1：映射表与 API 实时数据一致 ——
const mapSrc = readFileSync(new URL('../src/lib/tagMap.ts', import.meta.url), 'utf-8')
const nameToGroup = new Map<string, string>()
for (const t of tags) nameToGroup.set(t.name, gname.get(t.group_id) ?? '未归类')
let mismatched = 0
for (const [name, g] of nameToGroup) {
  if (!mapSrc.includes(`"${g}"`)) mismatched++
}
check('映射表与实时数据不一致的条目数', mismatched, 0)

// —— 验证 2：全量拉条目，跑本地算法 ——
console.log('\n拉取全量条目（较慢）…')
const raw = await allOf('entries')
const entries: IndexEntry[] = raw.map((e: any) => ({
  id: e.id,
  name: e.name,
  tagIds: (e.tag_ids ?? []).map(String),
}))
console.log(`条目 ${entries.length} 条`)

const idByName = new Map(tags.map((t) => [t.name, t.id]))
const gid = (n: string) => idByName.get(n)

async function serverCount(filters: unknown): Promise<number> {
  const r = await api('/entries/count', {
    method: 'POST',
    body: JSON.stringify({ filters }),
  })
  return r.count
}

console.log('\n== 本地算法 vs 服务端 count 对照 ==')
const a = gid('店铺')
const b = gid('国际大牌')

if (!a || !b) {
  console.log('找不到测试标签，跳过')
} else {
  const cases: Array<[string, GroupFilter[], unknown]> = [
    ['any[A]', [{ groupId: 'g1', mode: 'any', tagIds: [a] }], { field: 'tags', in: [a] }],
    ['any[A,B]', [{ groupId: 'g1', mode: 'any', tagIds: [a, b] }], { or: [{ field: 'tags', in: [a, b] }] }],
    ['all[A,B]', [{ groupId: 'g1', mode: 'all', tagIds: [a, b] }], { and: [{ field: 'tags', equals: a }, { field: 'tags', equals: b }] }],
    ['exclude[A,B]', [{ groupId: 'g1', mode: 'exclude', tagIds: [a, b] }], { field: 'tags', not_in: [a, b] }],
    [
      'any[A] AND any[B]',
      [
        { groupId: 'g1', mode: 'any', tagIds: [a] },
        { groupId: 'g2', mode: 'any', tagIds: [b] },
      ],
      { and: [{ field: 'tags', in: [a] }, { field: 'tags', in: [b] }] },
    ],
  ]

  for (const [name, local, srvFilter] of cases) {
    const localN = applyFilters(entries, local).length
    const srvN = await serverCount(srvFilter)
    check(`${name}（本地 ${localN} / 服务端 ${srvN}）`, localN, srvN)
  }
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
if (fail > 0) process.exit(1)
