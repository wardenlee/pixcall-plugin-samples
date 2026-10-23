/*
 * 标签数据层 —— 绕开 SDK 的 groupId 精度丢失
 *
 * ★ 根因（2026-10-12 用户诊断 + 实测确认）：
 *   tags[0].id      = string ✅ 正常
 *   tags[0].groupId = number ❌ 损坏（真实值 …982784，SDK 给 …982800）
 *   tagGroups[0].id = string ✅ 正常
 *   Entry.tagIds    = string[] ✅ 正常（与 tags.id 对得上）
 *   ⇒ 只有「标签 → 组」这条链路坏掉；对策：groupId 比对失败时用
 *     「标签名 → 组名」的本地映射表兜底（tagMap.ts）。
 *
 * ★ 2026-10-22 修 Bug：以前「未归类」组的标签 id 全写成 ''，
 *   于是所有未归类标签同时高亮、点任意一个命中 0。
 *   现在保留真实 tag id —— 组归属不可知，但筛选照常可用。
 */

import pixcall from 'pixcall'
import type { Tag, TagGroup } from 'pixcall'
import { parseCardinality, parseGroupLabel, parseGroupOrder, type Cardinality } from './filterLogic'
import { TAG_TO_GROUP } from './tagMap'

export type { IndexEntry, MatchMode, GroupFilter, Cardinality } from './filterLogic'
export { MATCH_MODE_LABEL, applyFilters, parseCardinality, parseGroupLabel, parseGroupOrder } from './filterLogic'

/** 归组后的标签项 */
export interface BucketTag {
  name: string
  id: string
  pinyin?: string
}

export interface GroupBucket {
  id: string
  rawName: string
  label: string
  order: number
  cardinality: Cardinality | null
  tags: BucketTag[]
}

export interface GroupDiag {
  byId: number
  byStr: number
  byMap: number
  unmapped: number
}

/** 取数组字段（多候选 + 兜底），避免取不到就静默变空 */
function pickArray<T>(...names: string[]): (page: unknown) => T[] {
  return (page: unknown): T[] => {
    if (!page || typeof page !== 'object') return []
    const obj = page as Record<string, unknown>
    for (const n of names) {
      if (Array.isArray(obj[n])) return obj[n] as T[]
    }
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && !/cursor/i.test(k)) return v as T[]
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const inner of Object.values(v as Record<string, unknown>)) {
          if (Array.isArray(inner)) return inner as T[]
        }
      }
    }
    return []
  }
}

async function fetchAll<T>(
  listFn: (opts: { limit?: number; cursor?: string }) => Promise<{ nextCursor?: string | null }>,
  pick: (page: unknown) => T[],
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  let guard = 0
  do {
    const page = await listFn({ limit: 200, cursor })
    out.push(...(pick(page) ?? []))
    cursor = page.nextCursor ?? undefined
    if (++guard > 300) break
  } while (cursor)
  return out
}

/**
 * 拉取标签组与标签并归组。
 * 归组策略（按可靠性依次尝试）：
 *   1. groupId 与组 id 直接比对
 *   2. groupId 转字符串后比对
 *   3. 标签名 → 本地映射表 TAG_TO_GROUP
 *   4. 都不中 → 进「未归类」（保留真实 id，仍可筛选）
 */
export async function loadGroupsAndTags(): Promise<{ buckets: GroupBucket[]; diag: GroupDiag }> {
  const groups = await fetchAll<TagGroup>(
    (opts) => pixcall.tagGroups.list<TagGroup>(opts),
    pickArray<TagGroup>('tagGroups', 'groups'),
  )
  const tags = await fetchAll<Tag>((opts) => pixcall.tags.list<Tag>(opts), pickArray<Tag>('tags'))

  const byName = new Map<string, TagGroup>()
  for (const g of groups) byName.set(g.name, g)

  const assigned = new Map<string, BucketTag[]>()
  let byId = 0
  let byStr = 0
  let byMap = 0
  const unmapped: BucketTag[] = []

  const put = (gid: string, tag: BucketTag) => {
    const list = assigned.get(gid)
    if (list) list.push(tag)
    else assigned.set(gid, [tag])
  }

  for (const t of tags) {
    const raw = t as unknown as Record<string, unknown>
    const bucket: BucketTag = { name: t.name, id: String(t.id), pinyin: raw.pinyin as string | undefined }

    let hit: string | null = null
    const gidAny = raw.groupId
    if (gidAny != null) {
      for (const g of groups) {
        if ((g.id as unknown) === gidAny) {
          hit = String(g.id)
          byId += 1
          break
        }
      }
      if (!hit) {
        const s = String(gidAny)
        for (const g of groups) {
          if (String(g.id) === s) {
            hit = String(g.id)
            byStr += 1
            break
          }
        }
      }
    }

    if (!hit) {
      const gname = TAG_TO_GROUP[t.name]
      if (gname) {
        const g = byName.get(gname)
        if (g) {
          hit = String(g.id)
          byMap += 1
        }
      }
    }

    if (hit) put(hit, bucket)
    else unmapped.push(bucket)
  }

  const buckets: GroupBucket[] = groups.map((g) => ({
    id: String(g.id),
    rawName: g.name,
    label: parseGroupLabel(g.name),
    order: parseGroupOrder(g.name),
    cardinality: parseCardinality(g.name),
    tags: (assigned.get(String(g.id)) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  }))

  if (unmapped.length > 0) {
    buckets.push({
      id: '__unmapped__',
      rawName: '未归类',
      label: '未归类',
      order: Number.MAX_SAFE_INTEGER,
      cardinality: null,
      tags: unmapped.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    })
  }

  return {
    buckets: buckets.sort((a, b) => a.order - b.order),
    diag: { byId, byStr, byMap, unmapped: unmapped.length },
  }
}
