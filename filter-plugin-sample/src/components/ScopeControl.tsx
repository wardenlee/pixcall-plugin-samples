/*
 * 范围控件（2026-10-23 需求①）
 *
 * 分裂按钮：
 *   · 主区：一键切换「已选文件夹 ⇄ 全库」
 *   · ▾：下拉面板 = 可折叠文件夹树 + **多选复选框（并集）** + 搜索 + 含子文件夹 + 最近使用
 *
 * 说明：宿主不提供「主界面当前文件夹」接口（只有勾选项），所以面板是范围的唯一自由入口；
 * 从左侧文件夹右键打开插件时会自动把该文件夹带进来。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDown, IconFolder, IconLibrary } from './Icons'
import { ancestorsOf, flattenFolders, folderPath, scopeNames, type FolderTree } from '../lib/folders'
import type { Scope } from '../lib/media'

export function ScopeControl({
  scope,
  tree,
  foldersLoaded,
  hostFolder,
  scopeCount,
  totalCount,
  recentFolders,
  hasFullData,
  onToggle,
  onSelectAll,
  onToggleFolder,
  onSelectFolders,
  onInvertFolders,
  onToggleIncludeSub,
  onRefreshFolders,
  onClearRecent,
}: {
  scope: Scope
  tree: FolderTree
  foldersLoaded: boolean
  /** 打开插件时宿主给的文件夹（从左侧文件夹右键唤起时） */
  hostFolder: { id: string; name: string } | null
  scopeCount: number
  totalCount: number
  recentFolders: string[]
  hasFullData: boolean
  onToggle: () => void
  onSelectAll: () => void
  onToggleFolder: (id: string) => void
  /** 批量勾选/取消（全选当前搜索结果用） */
  onSelectFolders: (ids: string[], selected: boolean) => void
  /** 批量反选（只作用于传入的 id 集合） */
  onInvertFolders: (ids: string[]) => void
  onToggleIncludeSub: () => void
  onRefreshFolders: () => void
  onClearRecent: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const bulkRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => (scope.kind === 'folders' ? scope.ids : []), [scope])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const label = scope.kind === 'all' ? '全库' : scopeNames(tree, selected)
  const path =
    scope.kind === 'all' ? '整库' : selected.length === 1 ? folderPath(tree, selected[0]) || label : `${label}（并集）`

  /** 当前「全选/反选」的作用集合：有搜索词 = 命中的文件夹；无搜索词 = 全部文件夹 */
  const flatAll = useMemo(() => flattenFolders(tree), [tree])
  const bulkIds = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return flatAll.map((x) => x.folder.id)
    return flatAll.filter((x) => x.folder.name.toLowerCase().includes(q)).map((x) => x.folder.id)
  }, [flatAll, query])
  const allChecked = bulkIds.length > 0 && bulkIds.every((id) => selectedSet.has(id))
  const someChecked = bulkIds.some((id) => selectedSet.has(id))

  useEffect(() => {
    const el = bulkRef.current
    if (el) el.indeterminate = !allChecked && someChecked
  }, [allChecked, someChecked])

  // 打开面板：展开顶层 + 已选项的祖先
  useEffect(() => {
    if (!open) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const f of tree.children.get('') ?? []) next.add(f.id)
      for (const id of selected) {
        next.add(id)
        for (const a of ancestorsOf(tree, id)) next.add(a)
      }
      return next
    })
    const t = window.setTimeout(() => searchRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open, tree, selected])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const searching = query.trim().length > 0
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: { id: string; name: string; depth: number; fileCount: number; hasChildren: boolean }[] = []
    const walk = (parentId: string, depth: number, guard: number) => {
      if (guard > 64) return
      for (const f of tree.children.get(parentId) ?? []) {
        const kids = tree.children.get(f.id) ?? []
        const hit = !q || f.name.toLowerCase().includes(q)
        if (!searching || hit) {
          out.push({ id: f.id, name: f.name, depth, fileCount: f.fileCount, hasChildren: kids.length > 0 })
        }
        // 搜索时也展开命中项的祖先；普通模式按展开状态
        if (searching || expanded.has(f.id)) walk(f.id, depth + 1, guard + 1)
      }
    }
    walk('', 0, 0)
    return out.slice(0, 600)
  }, [tree, expanded, query, searching])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTitle =
    scope.kind === 'folders'
      ? '一键切到全库'
      : recentFolders.length > 0
        ? '一键切回上次选的文件夹'
        : hostFolder
          ? `一键切回「${hostFolder.name}」`
          : '还没有选过文件夹 —— 点 ▾ 勾选'

  return (
    <div className="scope" ref={wrapRef}>
      <button
        type="button"
        className={`scope-main${scope.kind === 'folders' ? '' : ' is-all'}`}
        onClick={onToggle}
        title={toggleTitle}
      >
        {scope.kind === 'folders' ? <IconFolder size={13} /> : <IconLibrary size={13} />}
        <span className="scope-name">{label}</span>
        <span className="scope-count">{scopeCount.toLocaleString()}</span>
      </button>
      <button
        type="button"
        className={`scope-caret${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="选择筛选范围（可多选文件夹）"
        aria-label="选择筛选范围"
        aria-expanded={open}
      >
        <IconChevronDown />
      </button>

      {open && (
        <div className="scope-panel" role="dialog" aria-label="筛选范围">
          <div className="scope-panel-head">
            <span>筛选范围</span>
            <span className="scope-path" title={path}>
              {path}
            </span>
          </div>

          {!hasFullData && (
            <div className="scope-note">还没有全库数据：先点「扫描全库」一次，才能按文件夹筛选（结果会缓存，之后各文件夹通用）。</div>
          )}

          <div className="scope-quick">
            <button
              type="button"
              className={`scope-quick-btn${scope.kind === 'all' ? ' on' : ''}`}
              onClick={onSelectAll}
              title="整库（不限制文件夹）"
            >
              <IconLibrary size={13} />
              <span>全库</span>
              <span className="scope-quick-tag">{hasFullData ? totalCount.toLocaleString() : '—'}</span>
            </button>
            {hostFolder && (
              <button
                type="button"
                className={`scope-quick-btn${selectedSet.has(hostFolder.id) && selected.length === 1 ? ' on' : ''}`}
                onClick={() => onToggleFolder(hostFolder.id)}
                title="打开插件时主界面所在的文件夹（只选它）"
              >
                <IconFolder size={13} />
                <span className="scope-quick-name">{hostFolder.name}</span>
                <span className="scope-quick-tag">当前</span>
              </button>
            )}
          </div>

          {recentFolders.length > 0 && (
            <div className="scope-recent">
              <span className="hint">最近</span>
              {recentFolders.slice(0, 5).map((id) => {
                const f = tree.byId.get(id)
                if (!f) return null
                return (
                  <button
                    type="button"
                    key={id}
                    className={`scope-recent-btn${selectedSet.has(id) ? ' on' : ''}`}
                    onClick={() => onToggleFolder(id)}
                    title={folderPath(tree, id)}
                  >
                    {f.name}
                  </button>
                )
              })}
              <button type="button" className="scope-recent-clear" onClick={onClearRecent} title="清空最近使用">
                清空
              </button>
            </div>
          )}

          <label className="check scope-sub">
            <input
              type="checkbox"
              checked={scope.kind === 'folders' ? scope.includeSub : true}
              onChange={onToggleIncludeSub}
              disabled={scope.kind !== 'folders' || selected.length === 0}
            />
            含子文件夹（对所有已选文件夹生效）
          </label>

          <input
            ref={searchRef}
            className="input scope-search"
            placeholder={foldersLoaded ? '搜索文件夹…' : '文件夹列表加载中…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* 批量选择：作用于「当前搜索结果」（无搜索词时=全部文件夹） */}
          <div className="scope-bulk">
            <label className="check" title="勾选/取消当前搜索结果里的全部文件夹">
              <input
                ref={bulkRef}
                type="checkbox"
                checked={allChecked}
                onChange={() => onSelectFolders(bulkIds, !allChecked)}
                disabled={bulkIds.length === 0}
              />
              {searching ? `全选结果（${bulkIds.length}）` : `全选全部（${bulkIds.length}）`}
            </label>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onInvertFolders(bulkIds)}
              disabled={bulkIds.length === 0}
              title="把当前搜索结果里已勾的取消、未勾的勾上"
            >
              反选
            </button>
            <span className="hint">已选 {selected.length} 个</span>
          </div>

          <div className="folder-list">
            {!foldersLoaded && <div className="hint" style={{ padding: '10px 8px' }}>正在读取文件夹列表…</div>}
            {foldersLoaded && rows.length === 0 && (
              <div className="hint" style={{ padding: '10px 8px' }}>
                {searching ? '没有匹配的文件夹' : '宿主没有返回文件夹'}
              </div>
            )}
            {rows.map((r) => {
              const on = selectedSet.has(r.id)
              const isOpen = expanded.has(r.id) || searching
              return (
                <div key={r.id} className={`folder-row-wrap${on ? ' on' : ''}`}>
                  {r.hasChildren ? (
                    <button
                      type="button"
                      className="folder-carets"
                      onClick={() => toggleExpand(r.id)}
                      title={isOpen ? '收起' : '展开'}
                      aria-label={isOpen ? '收起' : '展开'}
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="folder-carets is-empty" />
                  )}
                  <label className="folder-row" style={{ paddingLeft: 2 + r.depth * 14 }} title={folderPath(tree, r.id)}>
                    <input type="checkbox" checked={on} onChange={() => onToggleFolder(r.id)} />
                    <IconFolder size={12} />
                    <span className="folder-name">{r.name}</span>
                    <span className="folder-count">{r.fileCount.toLocaleString()}</span>
                  </label>
                </div>
              )
            })}
          </div>

          <div className="scope-foot">
            <span className="hint">已选 {selected.length} 个文件夹{scope.kind === 'folders' && selected.length > 0 ? `（并集，${scope.includeSub ? '含子文件夹' : '仅本层'}）` : ''}</span>
            <button type="button" className="btn-ghost" onClick={onRefreshFolders} disabled={!foldersLoaded}>
              刷新文件夹列表
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
