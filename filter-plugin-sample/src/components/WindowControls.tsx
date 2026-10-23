/*
 * 三个窗口图标：还原 / 放大（满屏）/ 关闭
 *
 * 2026-10-23：状态扩展为 normal / fullscreen / resized（窗口被 resizeTo 放大时也算「已放大」）。
 * 三处（筛选 / 网格 / 单图）共用同一份实现。
 */

import { IconWinClose, IconWinMax, IconWinRestore } from './Icons'
import type { WindowStage } from '../hooks/useWindowStage'

export function WindowControls({
  stage,
  supported,
  onRestore,
  onMaximize,
  onClose,
  theme = 'light',
}: {
  stage: WindowStage
  supported: boolean
  onRestore: () => void
  onMaximize: () => void
  onClose: () => void
  theme?: 'light' | 'dark'
}) {
  const expanded = stage !== 'normal'
  const canMax = supported && !expanded
  const canRestore = expanded

  const cls = (enabled: boolean) => `win-btn${theme === 'dark' ? ' win-btn-dark' : ''}${enabled ? '' : ' is-off'}`

  return (
    <div className="win-group">
      <button
        type="button"
        className={cls(canRestore)}
        onClick={onRestore}
        disabled={!canRestore}
        title={canRestore ? '还原为窗口大小' : '当前已是窗口大小'}
        aria-label="还原"
      >
        <IconWinRestore />
      </button>
      <button
        type="button"
        className={cls(canMax)}
        onClick={onMaximize}
        disabled={!canMax}
        title={
          expanded
            ? stage === 'fullscreen'
              ? '已满屏'
              : '已放大窗口'
            : supported
              ? '放大（满屏）'
              : '此窗口不支持程序化放大，请用拖动边缘'
        }
        aria-label="放大"
      >
        <IconWinMax />
      </button>
      <button
        type="button"
        className={`${cls(true)} win-close${theme === 'dark' ? ' win-close-dark' : ''}`}
        onClick={onClose}
        title="关闭面板（关闭插件窗口）"
        aria-label="关闭"
      >
        <IconWinClose />
      </button>
    </div>
  )
}
