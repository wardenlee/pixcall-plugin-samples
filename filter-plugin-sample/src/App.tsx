/*
 * Pixcall 分组筛选 —— 主组件（2026-10-23 v0.3）
 *
 * 本轮用户反馈对应的改动：
 *   ① 范围：文件夹面板改成「可折叠树 + 多选复选框（并集）+ 搜索 + 最近使用」，范围可自由多选；
 *      「跟随主界面」按实测降级为「诊断」——宿主只提供勾选项、没有当前文件夹接口（按钮不再假装能跟）。
 *   ② 放大：manifest 加 fullscreenable:true（宿主源码里这就是全屏开关）+ 顶栏拖拽区 + resizeTo 兜底。
 *   ③ 批量标签输入：多标签自动分解/最长匹配/候选确认/应用后可撤销。
 *   ④ 第 1 行改为分段动态数据：范围 │ 总 │ 命中 │ 数据来源。
 *
 * 数据：打开时只读上次缓存（零扫描）；「扫描全库」始终手动。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import pixcall from 'pixcall'
import type { PluginContext, PluginInvocationContext } from 'pixcall'
import {
  applyFilters,
  loadGroupsAndTags,
  type GroupBucket,
  type GroupDiag,
  type GroupFilter,
  type MatchMode,
} from './lib/filterCore'
import { loadScan, peekScanManifest, saveScan } from './lib/scanCache'
import { filterByScope, listFolders, scanAllEntries } from './lib/scanner'
import { buildFolderTree, folderPath, scopeNames } from './lib/folders'
import { ImageGrid, ImageViewer, type GridSize } from './components/ImageViews'
import { FilterList } from './components/FilterList'
import { ScopeControl } from './components/ScopeControl'
import { TagPicker, splitTagTokens } from './components/TagPicker'
import { Diagnostics } from './components/Diagnostics'
import { WindowControls } from './components/WindowControls'
import { IconFilter, IconImage, IconRefresh } from './components/Icons'
import { useWindowStage } from './hooks/useWindowStage'
import type { FolderInfo, MediaEntry, Scope } from './lib/media'

type Phase = 'loading' | 'ready' | 'error'
type View = 'filter' | 'grid'

const SAVED_FILTER_KEY = 'saved-filter'
const SAVED_SCOPE_KEY = 'saved-scope'
const RECENT_FOLDERS_KEY = 'recent-folders'

interface SavedScope {
  kind: 'all' | 'folders'
  ids?: string[]
  includeSub?: boolean
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [progress, setProgress] = useState('')
  const [libPath, setLibPath] = useState('')
  const [fileServer, setFileServer] = useState('')
  const [invocation, setInvocation] = useState<PluginInvocationContext | null>(null)

  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [foldersLoaded, setFoldersLoaded] = useState(false)
  const [hostFolder, setHostFolder] = useState<{ id: string; name: string } | null>(null)
  const [recentFolders, setRecentFolders] = useState<string[]>([])
  const [scope, setScope] = useState<Scope>({ kind: 'all' })

  const [fullData, setFullData] = useState<MediaEntry[]>([])
  const [fullSource, setFullSource] = useState<'none' | 'cache' | 'scan'>('none')
  const [fullAt, setFullAt] = useState('')
  const [scanning, setScanning] = useState(false)

  const [groups, setGroups] = useState<GroupBucket[]>([])
  const [diag, setDiag] = useState<GroupDiag | null>(null)
  const [filters, setFilters] = useState<Record<string, GroupFilter>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [tagQuery, setTagQuery] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)

  const [view, setView] = useState<View>('filter')
  const [gridSize, setGridSize] = useState<GridSize>('m')
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [diagOpen, setDiagOpen] = useState(false)

  const notify = useCallback((msg: string) => setToast(msg), [])
  const win = useWindowStage(notify)

  const scanAbortRef = useRef(false)
  const lastFoldersRef = useRef<{ ids: string[]; includeSub: boolean } | null>(null)
  const lastIncludeSubRef = useRef(true)

  /* ══════════════ toast ══════════════ */

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 3800)
    return () => window.clearTimeout(t)
  }, [toast])

  /* ══════════════ 启动：零扫描 ══════════════ */

  const boot = useCallback(async () => {
    setPhase('loading')
    setErrorMsg('')
    setProgress('正在读取宿主上下文…')
    try {
      const ctx = await pixcall.getContext<PluginContext>()
      const path = ctx?.library?.path ?? ''
      const server = ctx?.library?.fileServer ?? ''
      setLibPath(path)
      setFileServer(server)
      setInvocation(ctx?.invocation ?? null)

      const inv = ctx?.invocation
      let host: { id: string; name: string } | null = null
      if (inv?.location === 'folder_tree' && inv.selection?.entryIds?.[0]) {
        host = { id: String(inv.selection.entryIds[0]), name: '当前文件夹' }
      }

      setProgress('正在读取标签与文件夹…')
      const [folderList, groupResult, savedScope, recent] = await Promise.all([
        listFolders().catch(() => [] as FolderInfo[]),
        loadGroupsAndTags().catch(() => ({
          buckets: [] as GroupBucket[],
          diag: { byId: 0, byStr: 0, byMap: 0, unmapped: 0 } as GroupDiag,
        })),
        readSavedScope(),
        readRecentFolders(),
      ])
      setFolders(folderList)
      setFoldersLoaded(true)
      setGroups(groupResult.buckets)
      setDiag(groupResult.diag)
      setRecentFolders(recent)

      if (host) {
        const hit = folderList.find((f) => f.id === host?.id)
        if (hit) host = { id: host.id, name: hit.name }
      }
      setHostFolder(host)

      // 范围：右键指定的文件夹优先；否则恢复上次范围；否则全库
      const validIds = (ids: string[] | undefined) =>
        (ids ?? []).filter((id) => folderList.some((f) => f.id === id))
      if (host) {
        setScope({ kind: 'folders', ids: [host.id], includeSub: savedScope?.includeSub ?? true })
      } else if (savedScope && savedScope.kind === 'folders') {
        const ids = validIds(savedScope.ids)
        setScope(ids.length > 0 ? { kind: 'folders', ids, includeSub: savedScope.includeSub ?? true } : { kind: 'all' })
      } else {
        setScope({ kind: 'all' })
      }

      const init: Record<string, GroupFilter> = {}
      for (const g of groupResult.buckets) init[g.id] = { groupId: g.id, mode: 'any', tagIds: [] }
      const saved = await loadSavedFilter()
      if (saved) {
        for (const f of saved) if (init[f.groupId]) init[f.groupId] = f
      }
      setFilters(init)

      // 数据：只读上次缓存
      const cached = await loadScan(path)
      if (cached && cached.length > 0) {
        setFullData(cached)
        setFullSource('cache')
        setFullAt((await peekScanManifest())?.savedAt ?? '')
      }
      setProgress('')
      setPhase('ready')
    } catch (e) {
      setPhase('error')
      setErrorMsg(String(e))
    }
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  /* 范围变化：持久化 + 记录最近使用 */
  useEffect(() => {
    if (phase !== 'ready') return
    if (scope.kind === 'folders') {
      lastFoldersRef.current = { ids: scope.ids, includeSub: scope.includeSub }
      lastIncludeSubRef.current = scope.includeSub
      if (scope.ids.length > 0) {
        setRecentFolders((prev) => {
          const next = [...scope.ids, ...prev.filter((id) => !scope.ids.includes(id))].slice(0, 8)
          void writeRecentFolders(next).catch(() => {})
          return next
        })
      }
    }
    const saved: SavedScope =
      scope.kind === 'folders'
        ? { kind: 'folders', ids: scope.ids, includeSub: scope.includeSub }
        : { kind: 'all' }
    void pixcall.storage.set(SAVED_SCOPE_KEY, JSON.stringify(saved)).catch(() => {})
  }, [scope, phase])

  /* 条件变化 → 存回 storage */
  useEffect(() => {
    if (phase !== 'ready') return
    const active = Object.values(filters).filter((f) => f.tagIds.length > 0)
    void writeSavedFilter(active).catch(() => {})
  }, [filters, phase])

  /* ══════════════ 派生数据 ══════════════ */

  const tree = useMemo(() => buildFolderTree(folders), [folders])

  const scoped = useMemo(() => filterByScope(fullData, scope, tree), [fullData, scope, tree])

  const activeFilters = useMemo(() => Object.values(filters).filter((f) => f.tagIds.length > 0), [filters])

  const matchedIds = useMemo(() => {
    const idx = scoped.map((e) => ({ id: e.id, name: '', tagIds: e.tagIds }))
    return applyFilters(idx, Object.values(filters))
  }, [scoped, filters])

  const matchedEntries = useMemo(() => {
    const byId = new Map(scoped.map((m) => [m.id, m]))
    const out: MediaEntry[] = []
    for (const id of matchedIds) {
      const e = byId.get(id)
      if (e) out.push(e)
    }
    return out
  }, [matchedIds, scoped])

  const tagTokens = useMemo(() => splitTagTokens(tagQuery), [tagQuery])

  const scopeLabel = scope.kind === 'all' ? '全库' : scopeNames(tree, scope.ids)
  const scopePath =
    scope.kind === 'all'
      ? '整库'
      : scope.ids.length === 1
        ? folderPath(tree, scope.ids[0]) || scopeLabel
        : scopeIdsPath(tree, scope.ids)
  const sourceShort =
    fullSource === 'cache'
      ? `缓存 ${formatTime(fullAt)}`
      : fullSource === 'scan'
        ? `已扫描 ${formatTime(fullAt)}`
        : '未载入'

  const resetKey = useMemo(
    () =>
      [
        scope.kind,
        scope.kind === 'folders' ? scope.ids.slice().sort().join(',') : '',
        scope.kind === 'folders' && scope.includeSub ? '1' : '0',
        activeFilters
          .map((f) => `${f.groupId}:${f.mode}:${f.tagIds.slice().sort().join('.')}`)
          .sort()
          .join('|'),
        fullAt,
        String(fullData.length),
        String(scoped.length),
        scoped[0]?.id ?? '',
      ].join('#'),
    [scope, activeFilters, fullAt, fullData.length, scoped],
  )

  /* 结果变短时把查看器 index 收回来 */
  useEffect(() => {
    if (viewerIdx === null) return
    if (matchedEntries.length === 0) {
      setViewerIdx(null)
      return
    }
    if (viewerIdx >= matchedEntries.length) setViewerIdx(matchedEntries.length - 1)
  }, [viewerIdx, matchedEntries.length])

  /* ══════════════ 操作 ══════════════ */

  const doScan = useCallback(async () => {
    if (scanning) return
    setScanning(true)
    scanAbortRef.current = false
    setProgress('正在扫描全库…')
    try {
      const list = await scanAllEntries(
        (loaded, page) => setProgress(`正在扫描… 已读取 ${loaded.toLocaleString()} 条（第 ${page} 页）`),
        () => scanAbortRef.current,
      )
      setFullData(list)
      setFullSource('scan')
      setFullAt(new Date().toISOString())
      setProgress('正在保存缓存…')
      const rep = await saveScan(list, libPath)
      await writeSavedFilter(activeFilters).catch(() => {})
      setProgress('')
      setScanning(false)
      if (rep.ok) {
        const note = rep.mode === 'noname' ? '（存储紧张：未存文件名）' : rep.mode === 'short' ? '（文件名已截短）' : ''
        setFullAt(new Date().toISOString())
        notify(`扫描完成 ${list.length.toLocaleString()} 条，缓存已保存 ${(rep.bytes / 1048576).toFixed(2)}MB${note}`)
      } else {
        notify(`扫描完成，但缓存保存失败：${rep.error ?? '未知原因'}（本次仍可使用，下次可能需重扫）`)
      }
    } catch (e) {
      setScanning(false)
      setProgress('')
      notify(`扫描失败：${String(e).slice(0, 140)}`)
    }
  }, [scanning, libPath, activeFilters, notify])

  const refreshFolders = useCallback(async () => {
    setProgress('正在刷新文件夹列表…')
    try {
      const list = await listFolders()
      setFolders(list)
      setFoldersLoaded(true)
      setProgress('')
      notify(`文件夹列表已刷新：${list.length} 个`)
    } catch (e) {
      setProgress('')
      notify(`刷新失败：${String(e).slice(0, 120)}`)
    }
  }, [notify])

  /** 一键切换：已选文件夹 ⇄ 全库 */
  const toggleScope = useCallback(() => {
    if (scope.kind === 'folders') {
      setScope({ kind: 'all' })
      return
    }
    const last = lastFoldersRef.current
    if (last && last.ids.length > 0) {
      setScope({ kind: 'folders', ids: last.ids, includeSub: last.includeSub })
      return
    }
    if (hostFolder) {
      setScope({ kind: 'folders', ids: [hostFolder.id], includeSub: lastIncludeSubRef.current })
      return
    }
    notify('还没有选过文件夹 —— 点范围右侧的 ▾ 勾选（可多选）')
  }, [scope.kind, hostFolder, notify])

  const selectAll = useCallback(() => setScope({ kind: 'all' }), [])

  const toggleFolder = useCallback((id: string) => {
    setScope((prev) => {
      const ids = prev.kind === 'folders' ? prev.ids : []
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
      if (next.length === 0) return { kind: 'all' }
      return { kind: 'folders', ids: next, includeSub: prev.kind === 'folders' ? prev.includeSub : lastIncludeSubRef.current }
    })
  }, [])

  /** 批量勾选/取消（面板的「全选搜索结果」） */
  const selectFolders = useCallback((ids: string[], selected: boolean) => {
    setScope((prev) => {
      const set = new Set(prev.kind === 'folders' ? prev.ids : [])
      if (selected) for (const id of ids) set.add(id)
      else for (const id of ids) set.delete(id)
      const next = [...set]
      if (next.length === 0) return { kind: 'all' }
      return { kind: 'folders', ids: next, includeSub: prev.kind === 'folders' ? prev.includeSub : lastIncludeSubRef.current }
    })
  }, [])

  /** 批量反选（面板的「反选」，只作用于搜索结果集合） */
  const invertFolders = useCallback((ids: string[]) => {
    setScope((prev) => {
      const set = new Set(prev.kind === 'folders' ? prev.ids : [])
      for (const id of ids) {
        if (set.has(id)) set.delete(id)
        else set.add(id)
      }
      const next = [...set]
      if (next.length === 0) return { kind: 'all' }
      return { kind: 'folders', ids: next, includeSub: prev.kind === 'folders' ? prev.includeSub : lastIncludeSubRef.current }
    })
  }, [])

  const toggleIncludeSub = useCallback(() => {
    setScope((s) => (s.kind === 'folders' ? { ...s, includeSub: !s.includeSub } : s))
  }, [])

  const clearRecent = useCallback(() => {
    setRecentFolders([])
    void writeRecentFolders([]).catch(() => {})
  }, [])

  const setMode = useCallback(
    (groupId: string, mode: MatchMode) => {
      setFilters((prev) => {
        const cur = prev[groupId]
        if (!cur) return prev
        const g = groups.find((x) => x.id === groupId)
        if (g?.cardinality?.single && mode !== 'any' && cur.tagIds.length > 1) {
          return { ...prev, [groupId]: { ...cur, mode, tagIds: cur.tagIds.slice(0, 1) } }
        }
        return { ...prev, [groupId]: { ...cur, mode } }
      })
    },
    [groups],
  )

  const toggleTag = useCallback(
    (groupId: string, tagId: string) => {
      setFilters((prev) => {
        const cur = prev[groupId] ?? { groupId, mode: 'any' as MatchMode, tagIds: [] }
        const has = cur.tagIds.includes(tagId)
        let tagIds = has ? cur.tagIds.filter((t) => t !== tagId) : [...cur.tagIds, tagId]
        const g = groups.find((x) => x.id === groupId)
        if (!has && g?.cardinality?.single && cur.mode !== 'any') tagIds = [tagId]
        return { ...prev, [groupId]: { ...cur, tagIds } }
      })
    },
    [groups],
  )

  const applyTags = useCallback((picks: { groupId: string; tagId: string }[]) => {
    setFilters((prev) => {
      const next = { ...prev }
      for (const p of picks) {
        const cur = next[p.groupId] ?? { groupId: p.groupId, mode: 'any' as MatchMode, tagIds: [] }
        if (!cur.tagIds.includes(p.tagId)) next[p.groupId] = { ...cur, tagIds: [...cur.tagIds, p.tagId] }
      }
      return next
    })
    notify(`已应用 ${picks.length} 个标签`)
  }, [notify])

  const removeTag = useCallback((groupId: string, tagId: string) => {
    setFilters((prev) => {
      const cur = prev[groupId]
      if (!cur) return prev
      return { ...prev, [groupId]: { ...cur, tagIds: cur.tagIds.filter((t) => t !== tagId) } }
    })
  }, [])

  const resetAll = useCallback(() => {
    setFilters((prev) => {
      const next: Record<string, GroupFilter> = {}
      for (const [k, v] of Object.entries(prev)) next[k] = { ...v, tagIds: [] }
      return next
    })
    setTagQuery('')
  }, [])

  const toggleCollapse = useCallback((groupId: string) => {
    setCollapsed((p) => ({ ...p, [groupId]: !p[groupId] }))
  }, [])

  const openViewer = useCallback((i: number) => setViewerIdx(i), [])

  /* ══════════════ 渲染 ══════════════ */

  if (phase === 'loading') {
    return (
      <div className="center">
        <div>
          <div className="center-title">Pixcall 分组筛选</div>
          <div className="hint">{progress || '正在加载…'}</div>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="center">
        <div>
          <div className="center-title">加载失败</div>
          <pre className="err">{errorMsg}</pre>
          <button type="button" className="btn" onClick={() => void boot()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  const dataActions = (
    <>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => void doScan()}
        disabled={scanning}
        title="手动扫描全库：约 2.4 万条，一次读入并缓存，之后各文件夹通用（不会自动触发）"
      >
        <IconRefresh size={13} />
        <span>扫描全库</span>
      </button>
      <button type="button" className="btn-ghost" onClick={() => setDiagOpen(true)} title="诊断：看宿主返回了什么、全屏能力、缓存状态">
        诊断
      </button>
    </>
  )

  return (
    <div className="app">
      {/* ═══ 第 1 行：标题 · 范围 · 动态数据（分段） · 视图切换 · 三窗口图标 ═══ */}
      <header className="topbar">
        <span className="topbar-title">Pixcall 分组筛选</span>

        <ScopeControl
          scope={scope}
          tree={tree}
          foldersLoaded={foldersLoaded}
          hostFolder={hostFolder}
          scopeCount={scoped.length}
          totalCount={fullData.length}
          recentFolders={recentFolders}
          hasFullData={fullData.length > 0}
          onToggle={toggleScope}
          onSelectAll={selectAll}
          onToggleFolder={toggleFolder}
          onSelectFolders={selectFolders}
          onInvertFolders={invertFolders}
          onToggleIncludeSub={toggleIncludeSub}
          onRefreshFolders={() => void refreshFolders()}
          onClearRecent={clearRecent}
        />

        <div className="metrics">
          <span className="metric" title="当前范围内的条目数">
            范围 <b>{scoped.length.toLocaleString()}</b>
          </span>
          <span className="metric-sep" />
          <span className="metric metric-optional" title="本地已载入的全库条目数">
            总 <b>{fullData.length.toLocaleString()}</b>
          </span>
          <span className="metric-sep metric-optional" />
          <span className="metric metric-hit" title="满足当前所有组条件的条目数">
            命中 <b>{matchedIds.length.toLocaleString()}</b>
          </span>
          <span className="metric-sep" />
          <span className="metric metric-muted metric-optional" title="数据来源与更新时间">
            数据 <b>{sourceShort}</b>
          </span>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setView(view === 'grid' ? 'filter' : 'grid')}
            title={view === 'grid' ? '切到筛选' : '切到看图'}
            aria-label={view === 'grid' ? '切到筛选' : '切到看图'}
          >
            {view === 'grid' ? <IconFilter size={16} /> : <IconImage size={16} />}
          </button>
          <span className="sep" />
          <WindowControls
            stage={win.stage}
            supported={win.supported}
            onRestore={() => void win.restore()}
            onMaximize={() => void win.maximize()}
            onClose={win.closeWindow}
          />
        </div>
      </header>

      {/* ═══ 第 2 行：操作 ═══ */}
      <div className="toolbar">
        {view === 'filter' ? (
          <>
            <TagPicker
              groups={groups}
              filters={filters}
              query={tagQuery}
              onQueryChange={setTagQuery}
              onApply={applyTags}
              onRemove={removeTag}
            />
            <label className="check">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              只看已启用
            </label>
            <button type="button" className="btn-ghost" onClick={resetAll}>
              清空
            </button>
            {scope.kind === 'folders' && (
              <label className="check" title={scopePath}>
                <input type="checkbox" checked={scope.includeSub} onChange={toggleIncludeSub} />
                含子文件夹
              </label>
            )}
            {diag && diag.unmapped > 0 && (
              <span className="hint" title="这些标签在本地映射表里找不到所属组，已放进「未归类」，仍可按标签 id 筛选">
                {diag.unmapped} 个标签未归类
              </span>
            )}
          </>
        ) : (
          <>
            <span className="hint">缩略图</span>
            {(['s', 'm', 'l'] as GridSize[]).map((g) => (
              <button
                type="button"
                key={g}
                className={gridSize === g ? 'btn-primary' : 'btn'}
                onClick={() => setGridSize(g)}
              >
                {g === 's' ? '小' : g === 'm' ? '中' : '大'}
              </button>
            ))}
            <span className="hint">{matchedIds.length.toLocaleString()} 张</span>
          </>
        )}

        <div className="toolbar-right">
          <span className="hint" title={scopePath}>
            {progress}
          </span>
          {dataActions}
        </div>
      </div>

      {/* ═══ 主体 ═══ */}
      {view === 'grid' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {fullData.length === 0 ? (
            <EmptyState
              title="还没有全库数据"
              hint="点「扫描全库」一次（约 2.4 万条，缓存后各文件夹通用）。范围可先用 ▾ 勾选多个文件夹。"
              onScan={() => void doScan()}
              scanning={scanning}
            />
          ) : scoped.length === 0 ? (
            <EmptyState
              title="这个范围里没有文件"
              hint={`范围：${scopePath}${scope.kind === 'folders' ? (scope.includeSub ? '（含子文件夹）' : '（仅本层）') : ''} —— 换个文件夹或改成「全库」`}
              onScan={() => void doScan()}
              scanning={scanning}
            />
          ) : matchedIds.length === 0 ? (
            <EmptyState
              title="没有命中的条目"
              hint={`当前范围 ${scoped.length.toLocaleString()} 条可选 —— 减少选中的标签，或改变组内匹配模式`}
              onScan={() => void doScan()}
              scanning={scanning}
            />
          ) : (
            <ImageGrid
              entries={matchedEntries}
              fileServer={fileServer}
              size={gridSize}
              resetKey={resetKey}
              onOpen={openViewer}
            />
          )}
        </div>
      ) : (
        <FilterList
          groups={groups}
          filters={filters}
          collapsed={collapsed}
          tagTokens={tagTokens}
          onlyActive={onlyActive}
          onToggleTag={toggleTag}
          onSetMode={setMode}
          onToggleCollapse={toggleCollapse}
        />
      )}

      {/* ═══ 底部状态 ═══ */}
      <footer className="footer">
        <span>组间固定「且」，组内按各自模式 · 数据只在本机，不发网络请求</span>
        <span style={{ marginLeft: 'auto' }}>
          范围：{scopePath}
          {scope.kind === 'folders' && scope.ids.length > 0 ? (scope.includeSub ? '（含子文件夹）' : '（仅本层）') : ''}
        </span>
        <span>{win.stage === 'fullscreen' ? '满屏中' : win.stage === 'resized' ? '已放大窗口' : ''}</span>
      </footer>

      {toast && (
        <div className="toast" onClick={() => setToast('')} role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {diagOpen && (
        <Diagnostics
          libPath={libPath}
          fileServer={fileServer}
          invocation={invocation}
          fullSource={fullSource}
          fullAt={fullAt}
          fullCount={fullData.length}
          foldersCount={folders.length}
          scopePath={scopePath}
          onClose={() => setDiagOpen(false)}
          notify={notify}
        />
      )}

      {viewerIdx !== null && matchedEntries.length > 0 && (
        <ImageViewer
          entries={matchedEntries}
          fileServer={fileServer}
          index={viewerIdx}
          stage={win.stage}
          supported={win.supported}
          onIndex={setViewerIdx}
          onClose={() => setViewerIdx(null)}
          onMaximize={() => void win.maximize()}
          onRestore={() => void win.restore()}
          onCloseWindow={win.closeWindow}
        />
      )}
    </div>
  )
}

/* ══════════════ 小组件 ══════════════ */

function EmptyState({
  title,
  hint,
  onScan,
  scanning,
}: {
  title: string
  hint: string
  onScan: () => void
  scanning: boolean
}) {
  return (
    <div className="empty">
      <div>
        <div style={{ fontSize: 14, marginBottom: 8 }}>{title}</div>
        <div className="hint" style={{ maxWidth: 460, lineHeight: 1.6 }}>
          {hint}
        </div>
        <div className="empty-actions">
          <button type="button" className="btn-primary" onClick={onScan} disabled={scanning}>
            {scanning ? '扫描中…' : '扫描全库'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════ 数据小工具 ══════════════ */

function scopeIdsPath(tree: ReturnType<typeof buildFolderTree>, ids: string[]): string {
  const names = ids
    .map((id) => tree.byId.get(id)?.name ?? id)
    .filter(Boolean)
  return names.length > 4 ? `${names.slice(0, 4).join(' / ')} 等 ${names.length} 个` : names.join(' / ')
}

async function loadSavedFilter(): Promise<GroupFilter[] | null> {
  try {
    const raw = await pixcall.storage.get(SAVED_FILTER_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return null
    const MODES: MatchMode[] = ['any', 'all', 'exclude']
    return v
      .filter(
        (x): x is GroupFilter =>
          Boolean(x) &&
          typeof x === 'object' &&
          typeof (x as GroupFilter).groupId === 'string' &&
          Array.isArray((x as GroupFilter).tagIds),
      )
      .map((f) => ({ groupId: f.groupId, tagIds: f.tagIds.map(String), mode: MODES.includes(f.mode) ? f.mode : 'any' }))
  } catch {
    return null
  }
}

async function writeSavedFilter(active: GroupFilter[]): Promise<void> {
  await pixcall.storage.set(SAVED_FILTER_KEY, JSON.stringify(active))
}

async function readSavedScope(): Promise<SavedScope | null> {
  try {
    const raw = await pixcall.storage.get(SAVED_SCOPE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as SavedScope
    if (v && (v.kind === 'all' || v.kind === 'folders')) return v
    return null
  } catch {
    return null
  }
}

async function readRecentFolders(): Promise<string[]> {
  try {
    const raw = await pixcall.storage.get(RECENT_FOLDERS_KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

async function writeRecentFolders(ids: string[]): Promise<void> {
  await pixcall.storage.set(RECENT_FOLDERS_KEY, JSON.stringify(ids))
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
