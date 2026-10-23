/*
 * 窗口三态控制（2026-10-23 修）
 *
 * 根因（宿主源码确认，app/js/main/main.js 的 open-plugin-window / XU）：
 *   BrowserWindow({ frame:false, fullscreenable: (window.fullscreen||window.fullscreenable)===true, ... })
 *   ⇒ manifest 不写 fullscreenable 时，宿主把窗口设成 **fullscreenable:false**，
 *     浏览器 Fullscreen API 被禁 → 旧版点「放大」没有任何反应。
 * 修复：manifest 的 window 里加 `"fullscreenable": true`（本轮已加）。
 *
 * 兜底顺序（都真实尝试，失败就明确说）：
 *   ① 浏览器 Fullscreen API（真·窗口全屏）
 *   ② window.resizeTo 到屏幕可用区（窗口本身 resizable:true；不使用 moveTo，避免旧报告的“锁左上角”）
 *   ③ 都不行 → 明确提示（不假装成功）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import pixcall from 'pixcall'

export type WindowStage = 'normal' | 'fullscreen' | 'resized'

export interface WindowStageApi {
  stage: WindowStage
  supported: boolean
  maximize: () => Promise<void>
  restore: () => Promise<void>
  closeWindow: () => void
}

const DEFAULT_W = 1180
const DEFAULT_H = 820

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function useWindowStage(notify: (msg: string) => void): WindowStageApi {
  const [stage, setStage] = useState<WindowStage>('normal')
  const [supported, setSupported] = useState(true)
  const stageRef = useRef<WindowStage>('normal')

  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  useEffect(() => {
    const sync = () => {
      if (document.fullscreenElement) setStage('fullscreen')
      else if (stageRef.current === 'fullscreen') setStage('normal')
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const maximize = useCallback(async () => {
    if (document.fullscreenElement) return

    // ① 真全屏
    if (document.fullscreenEnabled) {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        notify(`全屏被拒绝（${msg.slice(0, 50)}），尝试放大窗口…`)
      }
    }

    // ② 窗口放大到屏幕可用区
    try {
      const availW = window.screen?.availWidth ?? 0
      const availH = window.screen?.availHeight ?? 0
      if (availW > 0 && availH > 0) {
        const beforeW = window.outerWidth
        const beforeH = window.outerHeight
        window.resizeTo(availW, availH)
        await wait(150)
        const changed = Math.abs(window.outerWidth - beforeW) > 40 || Math.abs(window.outerHeight - beforeH) > 40
        if (changed) {
          setStage('resized')
          notify(`已放大窗口到 ${availW}×${availH}（宿主未允许全屏）`)
          return
        }
      }
    } catch {
      /* 继续提示 */
    }

    setSupported(false)
    notify('此窗口不允许程序化放大：请拖动窗口边缘调整，或重启 Pixcall 后再试（已记录到诊断）')
  }, [notify])

  const restore = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        /* 浏览器已退出 */
      }
      setStage('normal')
      return
    }
    if (stageRef.current === 'resized') {
      try {
        window.resizeTo(DEFAULT_W, DEFAULT_H)
      } catch {
        /* ignore */
      }
      setStage('normal')
    }
  }, [])

  const closeWindow = useCallback(() => {
    void pixcall.window.close()
  }, [])

  return { stage, supported, maximize, restore, closeWindow }
}
