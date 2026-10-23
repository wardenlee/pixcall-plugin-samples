/*
 * 端到端验证：插件生成的看板表达式 → 真实创建看板 → 核对 file_count
 * 对照基准：服务端 POST /entries/count
 */

import { buildBoardFilter } from '../src/lib/boardFilter.ts'

const KEY = process.env.PIX_KEY ?? ''
const BASE = 'http://127.0.0.1:22510/api/v1'
if (!KEY) {
  console.error('需要 PIX_KEY')
  process.exit(2)
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const t = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${t.slice(0, 160)}`)
  return t ? JSON.parse(t) : null
}

let pass = 0
let fail = 0
const created: string[] = []

async function boardFileCount(node: unknown): Promise<number> {
  const b = await api('/boards', {
    method: 'POST',
    body: JSON.stringify({ name: '__probe_e2e__', parent_id: '1', filters: node }),
  })
  created.push(b.id)
  // 等宿主异步算 file_count
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1200))
    const g = await api(`/boards/${b.id}`)
    if ((g.file_count ?? 0) > 0) return g.file_count
  }
  const g = await api(`/boards/${b.id}`)
  return g.file_count ?? -1
}

function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    pass++
    console.log(`  PASS  ${name} = ${actual}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} = ${actual}，期望 ${expected}`)
  }
}

try {
  const tags = await (async () => {
    const out: any[] = []
    let cur: string | undefined
    do {
      const d = await api(`/tags?limit=200${cur ? `&cursor=${cur}` : ''}`)
      out.push(...d.data)
      cur = d.next_cursor ?? undefined
    } while (cur)
    return out
  })()
  const byName = new Map(tags.map((t) => [t.name, t.id]))

  // 取两个「店铺/会所」这类互斥标签，以及跨组的「新中式」
  const A = byName.get('店铺')!
  const B = byName.get('会所')!
  const C = byName.get('新中式')!

  console.log('== 任意匹配（跨组：店铺 OR 新中式）==')
  const n1 = await boardFileCount(buildBoardFilter([{ tagId: A, mode: 'any' }, { tagId: C, mode: 'any' }]))
  const s1 = (await api('/entries/count', {
    method: 'POST',
    body: JSON.stringify({ filters: { or: [{ field: 'tags', in: [A, C] }] } }),
  })).count
  check(`看板 ${n1} vs 服务端 ${s1}`, n1, s1)

  console.log('\n== 任意匹配（同组：店铺 OR 会所）==')
  const n2 = await boardFileCount(buildBoardFilter([{ tagId: A, mode: 'any' }, { tagId: B, mode: 'any' }]))
  const s2 = (await api('/entries/count', {
    method: 'POST',
    body: JSON.stringify({ filters: { or: [{ field: 'tags', in: [A, B] }] } }),
  })).count
  check(`看板 ${n2} vs 服务端 ${s2}`, n2, s2)

  console.log('\n== 全部匹配（店铺 AND 会所）==')
  const n3 = await boardFileCount(buildBoardFilter([{ tagId: A, mode: 'all' }, { tagId: B, mode: 'all' }]))
  const s3 = (await api('/entries/count', {
    method: 'POST',
    body: JSON.stringify({ filters: { and: [{ field: 'tags', equals: A }, { field: 'tags', equals: B }] } }),
  })).count
  check(`看板 ${n3} vs 服务端 ${s3}`, n3, s3)

  console.log('\n== 组间且（任意:店铺/会所）AND（任意:新中式）==')
  const n4 = await boardFileCount(
    buildBoardFilter([
      { tagId: A, mode: 'any' },
      { tagId: B, mode: 'any' },
      { tagId: C, mode: 'all' },
    ]),
  )
  const s4 = (await api('/entries/count', {
    method: 'POST',
    body: JSON.stringify({
      filters: { and: [{ field: 'tags', in: [A, B] }, { field: 'tags', equals: C }] },
    }),
  })).count
  check(`看板 ${n4} vs 服务端 ${s4}`, n4, s4)
} finally {
  for (const id of created) {
    try {
      await api(`/boards/${id}`, { method: 'DELETE' })
    } catch {}
  }
  if (created.length) console.log(`\n已清理 ${created.length} 个测试看板`)
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`)
if (fail > 0) process.exit(1)
