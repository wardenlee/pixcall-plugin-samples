/*
 * 标签筛选列表（2026-10-23 适配批量标签输入）
 *
 * 组间恒「且」；组内三模式：任意 / 全部 / 排除。
 * 标签列表的「过滤」现在支持多个 token（空格/逗号等分隔，OR 匹配名称或拼音）。
 */

import { MATCH_MODE_LABEL, type GroupBucket, type GroupFilter, type MatchMode } from '../lib/filterCore'

export function FilterList({
  groups,
  filters,
  collapsed,
  tagTokens,
  onlyActive,
  onToggleTag,
  onSetMode,
  onToggleCollapse,
}: {
  groups: GroupBucket[]
  filters: Record<string, GroupFilter>
  collapsed: Record<string, boolean>
  tagTokens: string[]
  onlyActive: boolean
  onToggleTag: (groupId: string, tagId: string) => void
  onSetMode: (groupId: string, mode: MatchMode) => void
  onToggleCollapse: (groupId: string) => void
}) {
  const tokens = tagTokens.map((t) => t.trim().toLowerCase()).filter(Boolean)
  const visible = onlyActive ? groups.filter((g) => (filters[g.id]?.tagIds.length ?? 0) > 0) : groups

  if (visible.length === 0) {
    return (
      <div className="hint" style={{ padding: 12 }}>
        {groups.length === 0 ? '没有可用的标签组' : '没有符合条件的标签组（取消「只看已启用」试试）'}
      </div>
    )
  }

  return (
    <div className="list">
      {visible.map((g) => {
        const f = filters[g.id]
        const selected = f?.tagIds.length ?? 0
        const tags = g.tags.filter((t) => {
          if (tokens.length === 0) return true
          const name = t.name.toLowerCase()
          const pinyin = (t.pinyin ?? '').toLowerCase()
          return tokens.some((tok) => name.includes(tok) || pinyin.includes(tok))
        })
        const unmapped = g.id === '__unmapped__'
        return (
          <div key={g.id} className="group">
            <div className="group-head">
              <button
                type="button"
                className="fold"
                onClick={() => onToggleCollapse(g.id)}
                title={collapsed[g.id] ? '展开' : '收起'}
                aria-expanded={!collapsed[g.id]}
              >
                {collapsed[g.id] ? '▸' : '▾'}
              </button>
              <span className="group-name">{g.rawName}</span>
              {selected > 0 && <span className="badge">{selected}</span>}
              {unmapped && (
                <span className="hint" title="这些标签在本地映射表里找不到所属组；仍可按标签 id 参与筛选">
                  映射表未覆盖
                </span>
              )}
              <div className="modes">
                {(['any', 'all', 'exclude'] as MatchMode[]).map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={`mode-btn${f?.mode === m ? ' on' : ''}`}
                    onClick={() => onSetMode(g.id, m)}
                    disabled={Boolean(g.cardinality?.single) && m !== 'any' && selected > 1}
                    title={
                      g.cardinality?.single && selected > 1
                        ? '这个组每图只能有一个标签，先减少选择再切换模式'
                        : undefined
                    }
                  >
                    {MATCH_MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            {!collapsed[g.id] && (
              <div className="tags">
                {tags.length === 0 && <span className="hint">没有匹配的标签</span>}
                {tags.map((t) => {
                  const on = f?.tagIds.includes(t.id) ?? false
                  return (
                    <button
                      type="button"
                      key={t.id}
                      className={`tag${on ? ' on' : ''}`}
                      onClick={() => onToggleTag(g.id, t.id)}
                      title={t.name}
                    >
                      {t.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
