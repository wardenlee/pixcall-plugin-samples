/*
 * 图片网格 + 单图查看器（2026-10-22 重写）
 *
 * 修掉的老问题：
 *   · 换筛选结果后网格停在中段（滚动位置没归零）→ resetKey 变化时 scrollTop=0；
 *   · 重置签名太弱（首图+数量）→ 现在由 App 传入稳定 resetKey；
 *   · 查看器 index 越界时静默消失/诈尸 → Clamp + 由 App 兜底；
 *   · 视频/音频用 <img> 打开 → 黑屏 → 现在按 mediaType 选 <video>/<audio>；
 *   · 窗口按钮在这里另写一套（尺寸/颜色不一致）→ 统一用 <WindowControls>。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAudio, isVideo, masterUrl, placeholderLabel, thumbUrl, type MediaEntry } from '../lib/media'
import { IconArrowLeft } from './Icons'
import { WindowControls } from './WindowControls'
import type { WindowStage } from '../hooks/useWindowStage'

export type GridSize = 's' | 'm' | 'l'

const COL_W: Record<GridSize, number> = { s: 140, m: 220, l: 340 }
const PAGE = 300

/** 图片网格（增量渲染 + 换结果时归零） */
export const ImageGrid = memo(function ImageGrid({
  entries,
  fileServer,
  size,
  resetKey,
  onOpen,
}: {
  entries: MediaEntry[]
  fileServer: string
  size: GridSize
  /** 筛选 / 范围 / 数据批次变化时传一个新值，网格会重置滚动与已渲染数量 */
  resetKey: string
  onOpen: (index: number) => void
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [limit, setLimit] = useState(PAGE)
  const [loaded, setLoaded] = useState<Record<string, true>>({})
  const [failed, setFailed] = useState<Record<string, true>>({})

  useEffect(() => {
    setLimit(PAGE)
    setLoaded({})
    setFailed({})
    const el = scrollerRef.current
    if (el) el.scrollTop = 0
  }, [resetKey])

  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
      setLimit((n) => (n >= entries.length ? n : n + PAGE))
    }
  }, [entries.length])

  const shown = useMemo(() => entries.slice(0, limit), [entries, limit])

  const markLoaded = useCallback((id: string) => setLoaded((p) => (p[id] ? p : { ...p, [id]: true })), [])
  const markFailed = useCallback((id: string) => setFailed((p) => (p[id] ? p : { ...p, [id]: true })), [])

  return (
    <div className="grid-scroll" ref={scrollerRef} onScroll={onScroll}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${COL_W[size]}px, 1fr))` }}>
        {shown.map((e, i) => {
          const src = thumbUrl(fileServer, e)
          const bad = Boolean(failed[e.id])
          const ok = Boolean(loaded[e.id])
          return (
            <button
              type="button"
              key={e.id}
              className="grid-cell"
              onClick={() => onOpen(i)}
              title={e.name || e.id}
            >
              {src && !bad && (
                <img
                  className={`grid-img${ok ? ' is-loaded' : ''}`}
                  src={src}
                  alt={e.name || ''}
                  loading="lazy"
                  draggable={false}
                  onLoad={() => markLoaded(e.id)}
                  onError={() => markFailed(e.id)}
                />
              )}
              {(!src || bad) && <span className="grid-ph">{bad ? '缩略图不可用' : placeholderLabel(e)}</span>}
              {isVideo(e) && <span className="grid-badge">视频</span>}
            </button>
          )
        })}
      </div>
      {limit < entries.length && (
        <div className="loadmore">
          已显示 {limit.toLocaleString()} / {entries.length.toLocaleString()} 张 · 继续滚动加载
        </div>
      )}
    </div>
  )
})

/** 单图查看器 */
export function ImageViewer({
  entries,
  fileServer,
  index,
  stage,
  supported,
  onIndex,
  onClose,
  onMaximize,
  onRestore,
  onCloseWindow,
}: {
  entries: MediaEntry[]
  fileServer: string
  index: number
  stage: WindowStage
  supported: boolean
  onIndex: (i: number) => void
  /** 关查看器、回网格 */
  onClose: () => void
  onMaximize: () => void
  onRestore: () => void
  onCloseWindow: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const filmRef = useRef<HTMLDivElement>(null)
  const lockRef = useRef(false)

  const safeIndex = entries.length === 0 ? -1 : Math.min(Math.max(index, 0), entries.length - 1)
  const cur = safeIndex >= 0 ? entries[safeIndex] : null

  const go = useCallback(
    (delta: number) => {
      if (lockRef.current || entries.length === 0) return
      const next = safeIndex + delta
      if (next < 0 || next >= entries.length) return
      lockRef.current = true
      onIndex(next)
      window.setTimeout(() => (lockRef.current = false), 110)
    },
    [safeIndex, entries.length, onIndex],
  )

  useEffect(() => {
    boxRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const el = boxRef.current
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (Math.abs(e.deltaY) < 4) return
      go(e.deltaY > 0 ? 1 : -1)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'Escape') onClose()
    }
    el?.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      el?.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [go, onClose])

  // 胶片条把当前项滚进可视区
  useEffect(() => {
    const strip = filmRef.current
    if (!strip) return
    const active = strip.querySelector<HTMLElement>('[data-active="1"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [safeIndex])

  if (!cur) return null

  const src = masterUrl(fileServer, cur)
  const filmStart = Math.max(0, safeIndex - 40)
  const filmEnd = Math.min(entries.length, safeIndex + 41)
  const film = entries.slice(filmStart, filmEnd)

  return (
    <div className="viewer" ref={boxRef} tabIndex={-1}>
      <div className="viewer-bar">
        <button type="button" className="viewer-back" onClick={onClose} title="返回网格（Esc）" aria-label="返回网格">
          <IconArrowLeft />
        </button>
        <span className="viewer-title">{cur.name || cur.id}</span>
        <span className="viewer-meta">
          {safeIndex + 1} / {entries.length}
        </span>
        {cur.imageWidth && cur.imageHeight && (
          <span className="viewer-meta">
            {cur.imageWidth}×{cur.imageHeight}
          </span>
        )}
        {isVideo(cur) && <span className="viewer-meta">视频</span>}
        {isAudio(cur) && <span className="viewer-meta">音频</span>}
        <span className="viewer-hint">滚轮翻页 · ← → 切换 · Esc 返回</span>
        <WindowControls
          stage={stage}
          supported={supported}
          onRestore={onRestore}
          onMaximize={onMaximize}
          onClose={onCloseWindow}
          theme="dark"
        />
      </div>

      <div className="viewer-body" onClick={onClose}>
        {!src ? (
          <div className="viewer-empty">无法载入该文件</div>
        ) : isVideo(cur) ? (
          <video
            key={cur.id}
            className="viewer-media"
            src={src}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
          />
        ) : isAudio(cur) ? (
          <audio
            key={cur.id}
            style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '60%' }}
            src={src}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            key={cur.id}
            className="viewer-media"
            src={src}
            alt={cur.name}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      <div className="filmstrip" ref={filmRef} onClick={(e) => e.stopPropagation()}>
        {film.map((e, k) => {
          const i = filmStart + k
          const t = thumbUrl(fileServer, e)
          return (
            <button
              type="button"
              key={e.id}
              data-active={i === safeIndex ? '1' : undefined}
              className={`film${i === safeIndex ? ' on' : ''}`}
              onClick={() => onIndex(i)}
              title={e.name || e.id}
            >
              {t ? (
                <img
                  src={t}
                  alt=""
                  loading="lazy"
                  onError={(ev) => {
                    ev.currentTarget.style.visibility = 'hidden'
                  }}
                />
              ) : (
                <span>—</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
