/*
 * 批量标签输入（2026-10-23 需求③）
 *
 * 目标：一个输入框吃「多个标签名」，自动分解 + 提取出可筛选的标签，先出候选、确认后应用，应用后可改。
 *
 * 做法：
 *  1. **最长标签名优先**匹配（避免标签名里本身带「、」「空格」被切坏）；
 *  2. 剩下的文本按空格 / 逗号 / 顿号 / 分号 / 竖线 / 换行切成 token，做模糊匹配（包含 / 前缀 / 拼音）；
 *  3. 候选列表默认命中项全选，确认后一次性应用；未命中 token 明确列出来；
 *  4. 已应用的标签用 chip 展示，点 × 即撤销（=应用后可修改）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BucketTag, GroupBucket, GroupFilter } from '../lib/filterCore'

const DELIMS = /[\s,，、;；/|]+/

/** 把一段文本切成 token（供列表过滤使用） */
export function splitTagTokens(text: string): string[] {
  return text
    .trim()
    .split(DELIMS)
    .map((s) => s.trim())
    .filter(Boolean)
}

interface TagHit {
  group: GroupBucket
  tag: BucketTag
  exact: boolean
}

function allTagsOf(groups: GroupBucket[]): { group: GroupBucket; tag: BucketTag }[] {
  const out: { group: GroupBucket; tag: BucketTag }[] = []
  for (const g of groups) {
    for (const t of g.tags) if (t.id) out.push({ group: g, tag: t })
  }
  return out
}

/** 最长优先精确匹配 + 剩余 token 模糊匹配 */
export function matchTagText(text: string, groups: GroupBucket[]): { hits: TagHit[]; leftovers: string[]; tokens: string[] } {
  const raw = text.trim()
  if (!raw) return { hits: [], leftovers: [], tokens: [] }

  const all = allTagsOf(groups)
  const exactIds = new Set<string>()

  // 1) 最长标签名优先（命中处替换成分隔符，避免重叠）
  let work = raw
  const byLength = [...all].sort((a, b) => b.tag.name.length - a.tag.name.length)
  for (const x of byLength) {
    if (x.tag.name.length < 2) continue
    if (!work.includes(x.tag.name)) continue
    exactIds.add(x.tag.id)
    work = work.split(x.tag.name).join('\u0001')
  }

  // 2) 剩余 token 模糊匹配（每个 token 取最高分一个）
  const leftoverTokens = work
    .split(DELIMS)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const fuzzyIds = new Set<string>()
  const leftovers: string[] = []
  for (const token of leftoverTokens) {
    const lower = token.toLowerCase()
    let best: { id: string; score: number } | null = null
    for (const x of all) {
      if (exactIds.has(x.tag.id) || fuzzyIds.has(x.tag.id)) continue
      const name = x.tag.name.toLowerCase()
      const pinyin = (x.tag.pinyin ?? '').toLowerCase()
      let score = 0
      if (name === lower) score = 100
      else if (name.startsWith(lower)) score = 80
      else if (name.includes(lower)) score = 60
      else if (pinyin && pinyin.startsWith(lower)) score = 50
      else if (pinyin && pinyin.includes(lower)) score = 30
      if (score > 0 && (!best || score > best.score)) best = { id: x.tag.id, score }
    }
    if (best) fuzzyIds.add(best.id)
    else leftovers.push(token)
  }

  const hits: TagHit[] = []
  for (const x of all) {
    if (!exactIds.has(x.tag.id) && !fuzzyIds.has(x.tag.id)) continue
    hits.push({ group: x.group, tag: x.tag, exact: exactIds.has(x.tag.id) })
  }
  hits.sort((a, b) => a.group.order - b.group.order || a.tag.name.localeCompare(b.tag.name, 'zh-CN'))

  const tokens = splitTagTokens(raw)
  return { hits, leftovers, tokens }
}

export function TagPicker({
  groups,
  filters,
  query,
  onQueryChange,
  onApply,
  onRemove,
}: {
  groups: GroupBucket[]
  filters: Record<string, GroupFilter>
  query: string
  onQueryChange: (q: string) => void
  onApply: (picks: { groupId: string; tagId: string }[]) => void
  onRemove: (groupId: string, tagId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => matchTagText(query, groups), [query, groups])

  // 文本变化 → 候选默认全选
  useEffect(() => {
    if (!open) return
    const next: Record<string, boolean> = {}
    for (const h of parsed.hits) next[h.tag.id] = true
    setChecked(next)
  }, [parsed.hits, open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const activeTags = useMemo(() => {
    const out: { groupId: string; groupLabel: string; tagId: string; tagName: string }[] = []
    for (const g of groups) {
      const f = filters[g.id]
      if (!f || f.tagIds.length === 0) continue
      for (const id of f.tagIds) {
        const t = g.tags.find((x) => x.id === id)
        out.push({ groupId: g.id, groupLabel: g.label || g.rawName, tagId: id, tagName: t?.name ?? id })
      }
    }
    return out
  }, [groups, filters])

  const checkedCount = Object.values(checked).filter(Boolean).length

  const apply = () => {
    const picks: { groupId: string; tagId: string }[] = []
    for (const h of parsed.hits) {
      if (checked[h.tag.id]) picks.push({ groupId: h.group.id, tagId: h.tag.id })
    }
    if (picks.length === 0) return
    onApply(picks)
    onQueryChange('')
    setOpen(false)
  }

  return (
    <div className="tagbox" ref={wrapRef}>
      <input
        ref={inputRef}
        className="input tagbox-input"
        placeholder="批量标签：粘贴 / 输入多个标签名，回车识别…"
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        title="支持空格 / 逗号 / 顿号 / 分号 / 换行分隔；自动匹配库里的标签，先列候选再应用"
      />

      {open && query.trim() && (
        <div className="tagbox-panel" role="dialog" aria-label="批量标签候选">
          <div className="tagbox-head">
            <span>
              识别到 <b>{parsed.hits.length}</b> 个标签
            </span>
            {parsed.leftovers.length > 0 && <span className="tagbox-note">未匹配：{parsed.leftovers.join('、')}</span>}
          </div>

          <div className="tagbox-list">
            {parsed.hits.length === 0 && (
              <div className="hint" style={{ padding: 8 }}>
                没有匹配到标签，换个关键词试试
              </div>
            )}
            {parsed.hits.map((h) => (
              <label key={h.tag.id} className={`tagbox-row${checked[h.tag.id] ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(checked[h.tag.id])}
                  onChange={(e) => setChecked((p) => ({ ...p, [h.tag.id]: e.target.checked }))}
                />
                <span className="tagbox-tag">{h.tag.name}</span>
                <span className="tagbox-group">{h.group.rawName}</span>
                {!h.exact && <span className="tagbox-fuzzy">模糊</span>}
              </label>
            ))}
          </div>

          <div className="tagbox-foot">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                const next: Record<string, boolean> = {}
                const allOn = checkedCount >= parsed.hits.length && parsed.hits.length > 0
                for (const h of parsed.hits) next[h.tag.id] = !allOn
                setChecked(next)
              }}
            >
              {checkedCount >= parsed.hits.length && parsed.hits.length > 0 ? '全不选' : '全选'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={apply} disabled={checkedCount === 0}>
              应用 {checkedCount} 个标签
            </button>
          </div>
        </div>
      )}

      {activeTags.length > 0 && (
        <div className="tagchips" title="已启用的筛选标签（点 × 撤销）">
          {activeTags.map((t) => (
            <span key={t.groupId + ':' + t.tagId} className="chip">
              <span className="chip-group">{t.groupLabel}</span>
              <span className="chip-name">{t.tagName}</span>
              <button
                type="button"
                className="chip-x"
                onClick={() => onRemove(t.groupId, t.tagId)}
                title="撤销这个标签"
                aria-label={`撤销 ${t.tagName}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
