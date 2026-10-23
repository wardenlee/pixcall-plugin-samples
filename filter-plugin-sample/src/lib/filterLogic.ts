/*
 * 纯筛选逻辑 —— **不依赖 SDK，可在 Node 下直接跑验证脚本**
 * 数据获取在 filterCore.ts，本文件只负责计算。
 */

/** 一个条目的最小索引信息 —— 用标签 id（实测 Entry.tagIds 是 string 且可靠） */
export interface IndexEntry {
  id: string
  name: string
  /** 该条目的标签 id（string，可与 tags 的 id 直接比对） */
  tagIds: string[]
  /** 所属文件夹 id（用于按当前文件夹限定范围） */
  parentId?: string
  /** 本身是否是文件夹 */
  isFolder?: boolean
}

/** 组内匹配模式 —— 命名沿用 Pixcall 界面原文 */
export type MatchMode = 'any' | 'all' | 'exclude'

export const MATCH_MODE_LABEL: Record<MatchMode, string> = {
  any: '任意匹配',
  all: '全部匹配',
  exclude: '排除匹配',
}

/** 从组名解析基数预算，如「2-空间（每图≤1-2）」→ {min:1,max:2}；「5-明度（每图=1）」→ {min:1,max:1} */
export interface Cardinality {
  min: number
  max: number
  /** true 表示「每图=1」，此时组内只能单选 */
  single: boolean
}

export function parseCardinality(groupName: string): Cardinality | null {
  const m = groupName.match(/每图\s*(?:=|≤|<=|最多)\s*(\d+)(?:\s*-\s*(\d+))?/)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] ? Number(m[2]) : a
  return { min: a, max: b, single: b <= 1 }
}

/** 从组名里剥出排序序号，如「2-空间（每图≤1-2）」→ 2 */
export function parseGroupOrder(groupName: string): number {
  const m = groupName.match(/^\s*(\d+)/)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

/** 从组名里剥出显示名，如「2-空间（每图≤1-2）」→「空间」 */
export function parseGroupLabel(groupName: string): string {
  return groupName
    .replace(/^\s*\d+\s*[-、.]?\s*/, '')
    .replace(/[（(][^）)]*[）)]\s*$/, '')
    .trim()
}

/** 单个标签组的筛选条件 */
export interface GroupFilter {
  groupId: string
  mode: MatchMode
  tagIds: string[]
}

/**
 * 在本地索引上执行筛选。
 * 组间一律「且」；组内按各自 mode 判定。空条件的组不参与。
 *
 * 语义与实测服务端一致（2026-10-12）：
 *   any    = or[in ids]        命中任一即中
 *   all    = and[equals …]     必须全部命中
 *   exclude= not_in ids        命中任一即淘汰
 */
export function applyFilters(entries: IndexEntry[], filters: GroupFilter[]): string[] {
  const active = filters.filter((f) => f.tagIds.length > 0)
  if (active.length === 0) {
    return entries.map((e) => e.id)
  }

  const tagSets = active.map((f) => new Set(f.tagIds))
  const modes = active.map((f) => f.mode)

  const result: string[] = []
  outer: for (const entry of entries) {
    const tags = entry.tagIds
    for (let i = 0; i < tagSets.length; i++) {
      const set = tagSets[i]
      const mode = modes[i]

      if (mode === 'any') {
        let hit = false
        for (const t of tags) {
          if (set.has(t)) {
            hit = true
            break
          }
        }
        if (!hit) continue outer
      } else if (mode === 'all') {
        let allHit = true
        for (const id of set) {
          if (!tags.includes(id)) {
            allHit = false
            break
          }
        }
        if (!allHit) continue outer
      } else {
        // exclude：命中任一即淘汰
        for (const t of tags) {
          if (set.has(t)) continue outer
        }
      }
    }
    result.push(entry.id)
  }
  return result
}
