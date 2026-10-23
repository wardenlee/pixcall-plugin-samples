/*
 * 条目模型 + 图片地址构造
 *
 * 实测事实（2026-10-22 真机诊断，见交接文档）：
 *   fileServer = 宿主图片服务地址（**端口动态**，必须每次从 ctx.library.fileServer 读）
 *   缩略图     = {fileServer}/thumbs/{contentHash}
 *   原图       = {fileServer}/masters/{entryId}
 *   ✗ /thumbs/{entryId} → 404；✗ /masters/{contentHash} → 404；缩放参数无效
 */

export interface MediaEntry {
  id: string
  name: string
  /** 标签 id 列表（筛选用） */
  tagIds: string[]
  /** 内容哈希 → 缩略图地址 */
  contentHash: string | null
  /** 缩略图尺寸 */
  thumbWidth?: number
  thumbHeight?: number
  /** 原图尺寸 */
  imageWidth?: number
  imageHeight?: number
  /** image / video / audio / other */
  mediaType?: string
  /** 父文件夹 id（库根为空） */
  parentId?: string
  isFolder?: boolean
}

/** 筛选范围：整库 / 一组文件夹（并集，共用「含子文件夹」开关） */
export type Scope =
  | { kind: 'all' }
  | { kind: 'folders'; ids: string[]; includeSub: boolean }

/** 数据来源（决定「要不要扫描」的用户可见状态） */
export type DataSource = 'none' | 'cache' | 'scan'

/** 文件夹（来自宿主 folders.list） */
export interface FolderInfo {
  id: string
  name: string
  /** 空字符串 = 顶层 */
  parentId: string
  /** 宿主给出的「含子孙」文件数 */
  fileCount: number
  inTrash: boolean
}

/** 缩略图地址；无 contentHash 时返回 null */
export function thumbUrl(fileServer: string, e: MediaEntry): string | null {
  if (!e.contentHash) return null
  if (!fileServer) return null
  return `${fileServer}/thumbs/${e.contentHash}`
}

/**
 * 原图 / 原始媒体地址。
 * 注意：只有宿主拿到了条目（entryId）才可能命中，和 contentHash 无关。
 */
export function masterUrl(fileServer: string, e: MediaEntry): string | null {
  if (!fileServer) return null
  if (e.isFolder) return null
  return `${fileServer}/masters/${e.id}`
}

export function isVideo(e: MediaEntry): boolean {
  return e.mediaType === 'video'
}

export function isAudio(e: MediaEntry): boolean {
  return e.mediaType === 'audio'
}

/** 图片或视频才进查看器 */
export function isViewable(e: MediaEntry): boolean {
  if (e.isFolder) return false
  if (!e.mediaType) return true // 旧缓存没有 mediaType → 当作图片试
  return e.mediaType === 'image' || e.mediaType === 'video'
}

/** 网格占位文字（没有缩略图时显示什么） */
export function placeholderLabel(e: MediaEntry): string {
  if (e.mediaType === 'video') return '视频'
  if (e.mediaType === 'audio') return '音频'
  if (!e.contentHash) return e.name ? e.name.slice(0, 14) : '无缩略图'
  return e.name ? e.name.slice(0, 14) : '—'
}
