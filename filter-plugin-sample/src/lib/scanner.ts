/*
 * 宿主数据读取（只有「手动扫描 / 读取主界面选中项」两条路）
 *
 * ★ 2026-10-22 设计要点：
 *   1. 不自动全库扫描 —— 打开插件只读缓存 / 读主界面选中项；
 *   2. 扫描只拉**全库**一次，按文件夹裁剪在本地做（缓存一次服务所有文件夹）；
 *   3. `entries.list` / `listSelected` 只有 limit/cursor，没有文件夹过滤参数
 *      （SDK 类型 + 宿主路由实测），所以不在服务端筛。
 *
 * ★ 2026-10-22 修 Bug：
 *   · 以前扫描时把 `isFolder` 的条目全删掉，导致 filterByScope 拿文件表建父子关系，
 *     子文件夹永远进不去（「含子文件夹」等于没勾）。现在父子关系只来自 folders.list。
 *   · 扫描加页数上限与中断检查，避免 cursor 不前进时死循环。
 */

import pixcall from 'pixcall'
import type { FolderInfo, MediaEntry, Scope } from './media'
import { type FolderTree } from './folders'

/** 宿主原始 entry → 本插件模型 */
export function toMediaEntry(raw: unknown): MediaEntry {
  const r = raw as Record<string, unknown>
  const tagIds = Array.isArray(r.tagIds) ? (r.tagIds as unknown[]).map((x) => String(x)) : []
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    tagIds,
    contentHash: (r.contentHash as string | null) ?? null,
    thumbWidth: asNum(r.thumbWidth),
    thumbHeight: asNum(r.thumbHeight),
    imageWidth: asNum(r.imageWidth),
    imageHeight: asNum(r.imageHeight),
    mediaType: typeof r.mediaType === 'string' ? r.mediaType : undefined,
    parentId: r.parentId == null ? undefined : String(r.parentId),
    isFolder: Boolean(r.isFolder),
  }
}

function asNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** 从分页结果里取数组（兼容多种返回形状，但优先正式字段） */
function pickArray(obj: unknown, ...names: string[]): unknown[] {
  const o = obj as Record<string, unknown>
  for (const n of names) if (Array.isArray(o?.[n])) return o[n] as unknown[]
  for (const [k, v] of Object.entries(o ?? {})) {
    if (Array.isArray(v) && !/cursor|hasMore/i.test(k)) return v as unknown[]
  }
  return []
}

function nextCursorOf(obj: unknown): string | undefined {
  const o = obj as Record<string, unknown>
  const c = o?.nextCursor
  return typeof c === 'string' && c.length > 0 ? c : undefined
}

/** 扫描全库条目（不裁剪）。onProgress 每页回调；返回非文件夹条目。 */
export async function scanAllEntries(
  onProgress?: (loaded: number, page: number) => void,
  isAborted?: () => boolean,
): Promise<MediaEntry[]> {
  const all: MediaEntry[] = []
  let cursor: string | undefined
  let page = 0
  do {
    if (isAborted?.()) throw new Error('扫描已中断')
    if (page >= 600) throw new Error('扫描页数超过上限（600 页），已停止，结果可能不完整')
    const res = await pixcall.entries.list<Record<string, unknown>>({ limit: 200, cursor })
    for (const e of pickArray(res, 'entries')) {
      const m = toMediaEntry(e)
      if (!m.isFolder) all.push(m)
    }
    const next = nextCursorOf(res)
    // 防御：cursor 不前进就停
    if (next && next === cursor) break
    cursor = next
    page += 1
    onProgress?.(all.length, page)
  } while (cursor)
  return all
}

/** 全部文件夹（含宿主给的 fileCount，用于面板与范围计数） */
export async function listFolders(): Promise<FolderInfo[]> {
  const out: FolderInfo[] = []
  let cursor: string | undefined
  let guard = 0
  do {
    const res = (await pixcall.folders.list({ limit: 200, cursor })) as unknown as Record<string, unknown>
    for (const f of pickArray(res, 'folders')) {
      const r = f as Record<string, unknown>
      if (r.inTrash === true) continue
      out.push({
        id: String(r.id),
        name: String(r.name ?? ''),
        parentId: r.parentId == null ? '' : String(r.parentId),
        fileCount: asNum(r.fileCount) ?? 0,
        inTrash: false,
      })
    }
    const next = nextCursorOf(res)
    if (next && next === cursor) break
    cursor = next
    if (++guard > 200) break
  } while (cursor)
  return out
}

/**
 * 读取「主界面当前视图」的条目。
 *
 * ★ 2026-10-22 宿主侦察纠正：`library.entries.listSelected` 在宿主里映射到服务端
 *   `list_selected_entries`，返回的是**主界面当前选中节点（文件夹/看板/标签）下的条目**，
 *   也就是「主界面当前视图」，不是勾选项、也不是全库 —— 这正是「跟随主界面数据」的通道。
 *
 * @returns 条目数组；宿主不支持 / 调用失败时返回 null
 */
export async function listMainSelection(): Promise<MediaEntry[] | null> {
  try {
    const out: MediaEntry[] = []
    let cursor: string | undefined
    let guard = 0
    do {
      const res = (await pixcall.entries.listSelected<Record<string, unknown>>({ limit: 200, cursor })) as unknown as Record<string, unknown>
      for (const e of pickArray(res, 'entries')) {
        const m = toMediaEntry(e)
        if (!m.isFolder) out.push(m)
      }
      const next = nextCursorOf(res)
      if (next && next === cursor) break
      cursor = next
      if (++guard > 300) break
    } while (cursor)
    return out
  } catch {
    return null
  }
}

/** 主界面视图指纹（诊断用；只取 1 条） */
export async function mainViewFingerprint(): Promise<string> {
  try {
    const res = (await pixcall.entries.listSelected<Record<string, unknown>>({ limit: 1 })) as unknown as Record<string, unknown>
    const first = pickArray(res, 'entries')[0] as Record<string, unknown> | undefined
    if (!first) return ''
    return `${String(first.id ?? '')}|${first.parentId == null ? '' : String(first.parentId)}`
  } catch {
    return ''
  }
}

/** 按 id 批量取条目（用于「打开时带的选中 id」） */
export async function entriesByIds(ids: string[]): Promise<MediaEntry[]> {
  const out: MediaEntry[] = []
  const CHUNK = 100
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK)
    try {
      const list = await pixcall.entries.getByIds<Record<string, unknown>>(part)
      for (const e of list ?? []) {
        const m = toMediaEntry(e)
        if (!m.isFolder) out.push(m)
      }
    } catch {
      /* 单批失败不影响其余 */
    }
  }
  return out
}

/** 按范围裁剪（纯本地计算；范围来自全库数据，多文件夹取并集） */
export function filterByScope(all: MediaEntry[], scope: Scope, tree: FolderTree): MediaEntry[] {
  if (scope.kind === 'all') return all
  if (scope.ids.length === 0) return all

  // 多根 BFS：一次遍历得到所有已选文件夹（及其子树）的并集，避免对每个文件夹重复遍历
  const ids = new Set<string>()
  const queue: string[] = []
  for (const id of scope.ids) {
    if (!ids.has(id)) {
      ids.add(id)
      queue.push(id)
    }
  }
  if (scope.includeSub) {
    let guard = 0
    while (queue.length && guard++ < 200000) {
      const cur = queue.shift() as string
      for (const child of tree.children.get(cur) ?? []) {
        if (!ids.has(child.id)) {
          ids.add(child.id)
          queue.push(child.id)
        }
      }
    }
  }
  return all.filter((e) => !!e.parentId && ids.has(e.parentId))
}
