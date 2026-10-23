/*
 * 界面图标（内联 SVG，线性风格，stroke 1.6，对齐 Pixcall 的图标观感）
 *
 * ★ 2026-10-22：删掉与 Windows 标题栏图标重复的一套（IconShrink/Expand/Close），
 *   窗口控制统一用下面 3 个 10×10 的 Windows 风格图标。
 */

interface IconProps {
  size?: number
  className?: string
  style?: React.CSSProperties
  title?: string
}

function base(size: number, style?: React.CSSProperties) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
  }
}

export function IconFilter({ size = 15, style, title }: IconProps) {
  return (
    <svg {...base(size, style)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
    </svg>
  )
}

export function IconImage({ size = 15, style, title }: IconProps) {
  return (
    <svg {...base(size, style)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-9 9" />
    </svg>
  )
}

export function IconRefresh({ size = 15, style, title }: IconProps) {
  return (
    <svg {...base(size, style)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d="M20 11a8 8 0 1 0-2.3 6" />
      <path d="M20 5v6h-6" />
    </svg>
  )
}

/** 文件夹 / 范围 */
export function IconFolder({ size = 15, style, title }: IconProps) {
  return (
    <svg {...base(size, style)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

/** 全库 */
export function IconLibrary({ size = 15, style, title }: IconProps) {
  return (
    <svg {...base(size, style)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="16" rx="1" />
      <path d="M17 5l4 14" />
    </svg>
  )
}

/** 下拉箭头 */
export function IconChevronDown({ size = 12, style, title }: IconProps) {
  return (
    <svg {...base(size, style)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** 返回（查看器左上角） */
export function IconArrowLeft({ size = 14, style, title }: IconProps) {
  return (
    <svg {...base(size, style)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </svg>
  )
}

/** 数据来源 / 同步 */
export function IconSync({ size = 14, style, title }: IconProps) {
  return (
    <svg {...base(size, style)} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path d="M4 12a8 8 0 0 1 13.6-5.7L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.6 5.7L4 15.5" />
      <path d="M4 20v-4.5h4.5" />
    </svg>
  )
}

/* ═══════ Windows 标题栏风格（与主界面一致：细线、无圆角） ═══════ */

/** 还原（两层矩形） */
export function IconWinRestore({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
      <rect x="0.5" y="2.5" width="6" height="6" />
      <path d="M3 2.5V0.5h6.5V7H7.5" />
    </svg>
  )
}

/** 最大化（单个矩形） */
export function IconWinMax({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  )
}

/** 关闭（✕） */
export function IconWinClose({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </svg>
  )
}
