/*
 * 诊断面板（2026-10-23）
 *
 * 为什么要有它：用户实测「跟随主界面」失效。宿主链路是：
 *   SDK → request('library.entries.listSelected') → 主进程路由 → 服务端 RPC `list_selected_entries`
 * 该 RPC 只有 limit/cursor 两个参数，实测返回的是**主界面勾选的条目**（选 1 张返回 1 条），
 * 不是「当前文件夹」；宿主也没有「当前文件夹」接口。所以这里把原始调用结果、窗口全屏能力、
 * 上下文一起列出来，避免以后再靠猜。
 */

import { useCallback, useEffect, useState } from 'react'
import pixcall from 'pixcall'
import type { PluginInvocationContext } from 'pixcall'

interface SelProbe {
  state: 'loading' | 'ok' | 'error'
  count: number
  hasMore: boolean
  error: string
  sample: { id: string; parentId: string; name: string }[]
}

const EMPTY_PROBE: SelProbe = { state: 'loading', count: 0, hasMore: false, error: '', sample: [] }

export function Diagnostics({
  libPath,
  fileServer,
  invocation,
  fullSource,
  fullAt,
  fullCount,
  foldersCount,
  scopePath,
  onClose,
  notify,
}: {
  libPath: string
  fileServer: string
  invocation: PluginInvocationContext | null
  fullSource: 'none' | 'cache' | 'scan'
  fullAt: string
  fullCount: number
  foldersCount: number
  scopePath: string
  onClose: () => void
  notify: (msg: string) => void
}) {
  const [probe, setProbe] = useState<SelProbe>(EMPTY_PROBE)
  const [win, setWin] = useState({ inner: '', outer: '', screen: '', fullscreenEnabled: false, fullscreen: false })

  const readWindow = useCallback(() => {
    setWin({
      inner: `${window.innerWidth}×${window.innerHeight}`,
      outer: `${window.outerWidth}×${window.outerHeight}`,
      screen: `${window.screen?.availWidth ?? '?'}×${window.screen?.availHeight ?? '?'}`,
      fullscreenEnabled: Boolean(document.fullscreenEnabled),
      fullscreen: Boolean(document.fullscreenElement),
    })
  }, [])

  const runProbe = useCallback(async () => {
    setProbe(EMPTY_PROBE)
    try {
      const res = (await pixcall.entries.listSelected<Record<string, unknown>>({ limit: 50 })) as unknown as {
        entries?: Record<string, unknown>[]
        hasMore?: boolean
        nextCursor?: string | null
      }
      const list = Array.isArray(res?.entries) ? res.entries : []
      setProbe({
        state: 'ok',
        count: list.length,
        hasMore: Boolean(res?.hasMore),
        error: '',
        sample: list.slice(0, 5).map((e) => ({
          id: String(e.id ?? ''),
          parentId: e.parentId == null ? '' : String(e.parentId),
          name: String(e.name ?? ''),
        })),
      })
    } catch (e) {
      setProbe({
        state: 'error',
        count: 0,
        hasMore: false,
        error: e instanceof Error ? e.message : String(e),
        sample: [],
      })
    }
  }, [])

  useEffect(() => {
    void runProbe()
    readWindow()
  }, [runProbe, readWindow])

  const text = [
    '【Pixcall 分组筛选 · 诊断】',
    `库路径：${libPath || '(空)'}`,
    `图片服务：${fileServer || '(空)'}`,
    `调用上下文：${invocation ? JSON.stringify(invocation) : '(无)'}`,
    `窗口内尺寸：${win.inner} / 外尺寸：${win.outer} / 屏幕：${win.screen}`,
    `fullscreenEnabled：${win.fullscreenEnabled} / 当前全屏：${win.fullscreen}`,
    `全库数据：${fullSource}${fullAt ? ` (${fullAt})` : ''} · ${fullCount} 条`,
    `文件夹数：${foldersCount}`,
    `当前范围：${scopePath}`,
    '—— 主界面「选中项」探测 ——',
    probe.state === 'loading'
      ? '调用中…'
      : probe.state === 'error'
        ? `调用失败：${probe.error}`
        : `返回 ${probe.count} 条（hasMore=${probe.hasMore}）${probe.sample.map((s) => `\n  · ${s.name} (parent=${s.parentId})`).join('')}`,
    '—— 结论 ——',
    '宿主只提供「主界面勾选的条目」，没有「主界面当前文件夹」接口 ⇒ 插件无法自动跟随文件夹；范围请用文件夹多选，或从左侧文件夹右键打开插件自动带入。',
  ].join('\n')

  const copy = async () => {
    try {
      await pixcall.clipboard.copyText(text)
      notify('诊断信息已复制到剪贴板')
    } catch {
      notify('复制失败：可以手动选中下面的文字')
    }
  }

  return (
    <div className="diag-mask" onClick={onClose}>
      <div className="diag" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="诊断">
        <div className="diag-head">
          <span>诊断</span>
          <div className="diag-actions">
            <button type="button" className="btn-ghost" onClick={() => void runProbe()}>
              重新探测
            </button>
            <button type="button" className="btn-ghost" onClick={() => void copy()}>
              复制
            </button>
            <button type="button" className="btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="diag-body">
          <div className="diag-grid">
            <span>库路径</span>
            <code>{libPath || '—'}</code>
            <span>图片服务</span>
            <code>{fileServer || '—'}</code>
            <span>窗口</span>
            <code>
              内容 {win.inner} · 窗口 {win.outer} · 屏幕 {win.screen}
            </code>
            <span>全屏能力</span>
            <code>
              fullscreenEnabled = {String(win.fullscreenEnabled)} · 当前全屏 = {String(win.fullscreen)}
            </code>
            <span>调用上下文</span>
            <code>{invocation ? JSON.stringify(invocation) : '(无)'}</code>
            <span>全库数据</span>
            <code>
              {fullSource}
              {fullAt ? ` · ${fullAt}` : ''} · {fullCount.toLocaleString()} 条
            </code>
            <span>文件夹 / 范围</span>
            <code>
              {foldersCount} 个 · {scopePath}
            </code>
          </div>

          <div className="diag-sec">
            <div className="diag-sec-title">主界面「选中项」探测（listSelected）</div>
            {probe.state === 'loading' && <div className="hint">调用中…</div>}
            {probe.state === 'error' && <pre className="diag-pre">{probe.error}</pre>}
            {probe.state === 'ok' && (
              <>
                <div>
                  返回 <b>{probe.count}</b> 条{probe.hasMore ? '（还有更多）' : ''}
                </div>
                {probe.sample.length > 0 && (
                  <pre className="diag-pre">
                    {probe.sample
                      .map((s) => `${s.id}  parent=${s.parentId || '(根)'}  ${s.name}`)
                      .join('\n')}
                  </pre>
                )}
              </>
            )}
            <div className="diag-tip">
              实测：主界面勾选 1 张 → 这里返回 1 条。它是「勾选项」，不是「当前文件夹」；宿主没有提供当前文件夹接口。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
