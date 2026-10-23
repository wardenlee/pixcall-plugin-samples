/*
 * 文件夹树工具（纯函数，无 SDK 依赖）
 *
 * ★ 2026-10-22 修 Bug：以前「含子文件夹」拿条目表建父子关系，
 *   而条目表里没有文件夹 ⇒ BFS 只走一层，子文件夹全丢。
 *   现在父子关系一律来自宿主 folders.list（唯一真相）。
 */

import type { FolderInfo } from './media'

export interface FolderTree {
  byId: Map<string, FolderInfo>
  /** parentId（'' = 顶层）→ 子文件夹（按名称排序） */
  children: Map<string, FolderInfo[]>
}

export function buildFolderTree(folders: FolderInfo[]): FolderTree {
  const byId = new Map<string, FolderInfo>()
  for (const f of folders) byId.set(f.id, f)

  const children = new Map<string, FolderInfo[]>()
  for (const f of folders) {
    // 父 id 指向一个不存在的文件夹（或自身）时，视为顶层，避免整棵树蒸发
    const parent = f.parentId && byId.has(f.parentId) && f.parentId !== f.id ? f.parentId : ''
    const list = children.get(parent)
    if (list) list.push(f)
    else children.set(parent, [f])
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return { byId, children }
}

/** 自身 + 所有子孙文件夹 id（includeSub=false 时只返回自身） */
export function scopeFolderIds(tree: FolderTree, folderId: string, includeSub: boolean): Set<string> {
  const ids = new Set<string>([folderId])
  if (!includeSub) return ids
  const queue: string[] = [folderId]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const child of tree.children.get(cur) ?? []) {
      if (!ids.has(child.id)) {
        ids.add(child.id)
        queue.push(child.id)
      }
    }
  }
  return ids
}

/** 面包屑路径：A / B / C */
export function folderPath(tree: FolderTree, folderId: string): string {
  const names: string[] = []
  let cur = tree.byId.get(folderId)
  let guard = 0
  while (cur && guard++ < 64) {
    names.unshift(cur.name)
    cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined
  }
  return names.join(' / ')
}

/** 祖先 id 列表（不含自身，由近到远） */
export function ancestorsOf(tree: FolderTree, folderId: string): string[] {
  const out: string[] = []
  let cur = tree.byId.get(folderId)
  let guard = 0
  while (cur && cur.parentId && guard++ < 64) {
    out.push(cur.parentId)
    cur = tree.byId.get(cur.parentId)
  }
  return out
}

/** 一组文件夹的显示名：1 个用名字，多个用「N 个文件夹」 */
export function scopeNames(tree: FolderTree, ids: string[]): string {
  if (ids.length === 0) return '全库'
  if (ids.length === 1) return tree.byId.get(ids[0])?.name ?? '已选文件夹'
  return `${ids.length} 个文件夹`
}

export interface FlatFolder {
  folder: FolderInfo
  depth: number
}

/** 按树展开成可渲染的一维列表 */
export function flattenFolders(tree: FolderTree): FlatFolder[] {
  const out: FlatFolder[] = []
  const walk = (parentId: string, depth: number, guard: number) => {
    if (guard > 64) return
    for (const f of tree.children.get(parentId) ?? []) {
      out.push({ folder: f, depth })
      walk(f.id, depth + 1, guard + 1)
    }
  }
  walk('', 0, 0)
  return out
}

/** 搜索过滤：命中项 + 它的所有祖先都保留，避免树被切断 */
export function filterFlatFolders(flat: FlatFolder[], query: string): FlatFolder[] {
  const q = query.trim().toLowerCase()
  if (!q) return flat
  const keep = new Set<number>()
  flat.forEach((item, i) => {
    if (!item.folder.name.toLowerCase().includes(q)) return
    keep.add(i)
    // 沿 depth 回找祖先
    let depth = item.depth - 1
    for (let j = i - 1; j >= 0 && depth >= 0; j--) {
      if (flat[j].depth === depth) {
        keep.add(j)
        depth -= 1
      }
    }
  })
  return flat.filter((_, i) => keep.has(i))
}
