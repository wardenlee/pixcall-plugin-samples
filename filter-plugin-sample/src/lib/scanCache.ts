/*
 * 扫描结果缓存 —— schema v4（2026-10-22 重写）
 *
 * ★ 为什么要重写（交接文档 + 审计确认过的坑）：
 *   1. storage 总容量 5MB（用户实测 `Storage limit reached: 5242880`）；
 *   2. 旧实现「先 hardClear 再写」，一旦写失败**旧缓存已经没了** → 重开就得重扫；
 *   3. 预算按字符算、上限按字节 → 算得过、写不进；
 *   4. 旧编码 `split(',')` 会把含逗号的文件名截断；
 *   5. 旧编码丢 mediaType / 尺寸 → 走缓存时视频变「无缩略图」、尺寸消失；
 *   6. 没有 schema 版本 → 以后改编码会把旧缓存静默读成错数据。
 *
 * ★ v4 做法：
 *   · 每代一个 gen 前缀：**先写新代 → 校验 → 再删旧代**（写失败不动旧数据）；
 *   · manifest 带 schema，版本不符直接当没有；
 *   · 预算用 TextEncoder 的**真实字节**；
 *   · contentHash 用 base64（64 hex → 43 字符，24k 条约省 0.5MB）；
 *   · 文件名转义（`\\` `\,` `\n` `\r`），字段按「前 6 个未转义逗号」切分；
 *   · 加 mediaType（1 字符）与图片尺寸（base36，约 7 字节）；
 *   · 保留 v3 读取路径，老缓存不必重扫。
 */

import pixcall from 'pixcall'
import type { MediaEntry } from './media'

const SCHEMA = 4
const KEY_MANIFEST = 'scan4.manifest'
const chunkKey = (gen: string, i: number) => `scan4.${gen}.c${i}`
const parentsKey = (gen: string) => `scan4.${gen}.p`
const tagsKey = (gen: string) => `scan4.${gen}.t`

/** 词典型数据 + 分片的总字节预算（总容量 5MB，留足余量给旧代与筛选条件） */
const BUDGET = 3_600_000
/** 旧代 + 新代超过这个量就先删旧代腾地方 */
const COEXIST_LIMIT = 4_600_000
/** 单片目标字符数 */
const SLICE_CHARS = 250_000

export interface SaveReport {
  ok: boolean
  mode: 'full' | 'short' | 'noname' | 'none'
  chunks: number
  bytes: number
  ms: number
  error?: string
  verified: boolean
  /** 实际保留的文件名字节上限（0 = 不存） */
  nameBytes: number
}

export interface CacheManifest {
  schema: number
  libraryPath: string
  count: number
  chunks: number
  bytes: number
  nameBytes: number
  savedAt: string
}

const encoder = new TextEncoder()
function byteLen(s: string): number {
  return encoder.encode(s).length
}

/* ══════════════ 文件名转义 ══════════════ */

function escapeName(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/,/g, '\\c')
}

function unescapeName(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const n = s[i + 1]
    i += 1
    if (n === 'n') out += '\n'
    else if (n === 'r') out += '\r'
    else if (n === 'c') out += ','
    else if (n === '\\') out += '\\'
    else out += n ?? ''
  }
  return out
}

/** 按「未被转义的逗号」切前 count 段（最后一段含剩余内容） */
function splitFields(line: string, count: number): string[] {
  const out: string[] = []
  let start = 0
  let i = 0
  while (i < line.length && out.length < count - 1) {
    if (line[i] === ',') {
      let backslashes = 0
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes += 1
      if (backslashes % 2 === 0) {
        out.push(line.slice(start, i))
        start = i + 1
      }
    }
    i += 1
  }
  out.push(line.slice(start))
  return out
}

/** UTF-8 安全截断（不切坏多字节字符） */
function cutUtf8(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (byteLen(s) <= maxBytes) return s
  let out = ''
  let used = 0
  for (const ch of s) {
    const n = byteLen(ch)
    if (used + n > maxBytes) break
    out += ch
    used += n
  }
  return out
}

/* ══════════════ contentHash：hex ⇄ base64 ══════════════ */

function hexToB64(hex: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return '~' + hex
  let bin = ''
  for (let i = 0; i < 64; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  return btoa(bin)
}

function b64ToHex(v: string): string | null {
  if (v === '') return null
  if (v.startsWith('~')) return v.slice(1)
  try {
    const bin = atob(v)
    let out = ''
    for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0')
    return out
  } catch {
    return null
  }
}

/* ══════════════ 媒体类型 / 尺寸编码 ══════════════ */

function mediaCode(t?: string): string {
  if (t === 'image') return 'i'
  if (t === 'video') return 'v'
  if (t === 'audio') return 'a'
  if (!t) return '-'
  return 'o'
}

function mediaFromCode(c: string): string | undefined {
  if (c === 'i') return 'image'
  if (c === 'v') return 'video'
  if (c === 'a') return 'audio'
  if (c === 'o') return 'other'
  return undefined
}

function dimsOf(e: MediaEntry): string {
  if (!e.imageWidth || !e.imageHeight) return ''
  return `${Math.round(e.imageWidth).toString(36)}x${Math.round(e.imageHeight).toString(36)}`
}

function parseDims(s: string): { w?: number; h?: number } {
  if (!s) return {}
  const parts = s.split('x')
  const W = parseInt(parts[0] ?? '', 36)
  const H = parseInt(parts[1] ?? '', 36)
  return Number.isFinite(W) && Number.isFinite(H) ? { w: W, h: H } : {}
}

/* ══════════════ 编解码 ══════════════ */

interface Payload {
  chunks: string[]
  parents: string
  tags: string
  bytes: number
}

function encodeAll(entries: MediaEntry[], nameBytes: number): Payload {
  const parentIdx = new Map<string, number>()
  const parents: string[] = []
  const tagIdx = new Map<string, number>()
  const tags: string[] = []
  const lines: string[] = []

  for (const e of entries) {
    let pi = ''
    const p = e.parentId ?? ''
    if (p) {
      let idx = parentIdx.get(p)
      if (idx === undefined) {
        idx = parents.length
        parentIdx.set(p, idx)
        parents.push(p)
      }
      pi = String(idx)
    }
    let ts = ''
    if (e.tagIds.length > 0) {
      const ids: string[] = []
      for (const t of e.tagIds) {
        let idx = tagIdx.get(t)
        if (idx === undefined) {
          idx = tags.length
          tagIdx.set(t, idx)
          tags.push(t)
        }
        ids.push(String(idx))
      }
      ts = ids.join('|')
    }
    const nm = nameBytes > 0 ? cutUtf8(e.name, nameBytes) : ''
    lines.push(
      `${e.id},${e.contentHash ? hexToB64(e.contentHash) : ''},${pi},${ts},${mediaCode(e.mediaType)},${dimsOf(e)},${escapeName(nm)}`,
    )
  }

  const text = lines.join('\n')
  const parentsStr = parents.join('\n')
  const tagsStr = tags.join('\n')
  return {
    chunks: sliceText(text),
    parents: parentsStr,
    tags: tagsStr,
    bytes: byteLen(text) + byteLen(parentsStr) + byteLen(tagsStr),
  }
}

function sliceText(text: string): string[] {
  const lines = text.split('\n')
  const chunks: string[] = []
  let cur = ''
  for (const line of lines) {
    if (cur.length + line.length + 1 > SLICE_CHARS && cur) {
      chunks.push(cur)
      cur = ''
    }
    cur += (cur ? '\n' : '') + line
  }
  if (cur) chunks.push(cur)
  return chunks
}

function decodeAll(lines: string[], parents: string[], tags: string[]): MediaEntry[] {
  const out: MediaEntry[] = []
  for (const line of lines) {
    if (!line) continue
    const f = splitFields(line, 7)
    const id = f[0] ?? ''
    if (!id) continue
    const d = parseDims(f[5] ?? '')
    out.push({
      id,
      contentHash: b64ToHex(f[1] ?? ''),
      parentId: f[2] ? parents[Number(f[2])] : undefined,
      tagIds: f[3]
        ? f[3]
            .split('|')
            .filter((x) => x !== '')
            .map((x) => tags[Number(x)])
            .filter((x): x is string => Boolean(x))
        : [],
      mediaType: mediaFromCode(f[4] ?? '-'),
      imageWidth: d.w,
      imageHeight: d.h,
      name: unescapeName(f[6] ?? ''),
    })
  }
  return out
}

/* ══════════════ 读取 ══════════════ */

async function readManifest(): Promise<(CacheManifest & { gen: string }) | null> {
  try {
    const raw = await pixcall.storage.get(KEY_MANIFEST)
    if (!raw) return null
    const man = JSON.parse(raw) as Partial<CacheManifest> & { gen?: string }
    if (man.schema !== SCHEMA || typeof man.gen !== 'string' || !man.gen) return null
    return {
      schema: SCHEMA,
      gen: man.gen,
      libraryPath: String(man.libraryPath ?? ''),
      count: Number(man.count ?? 0),
      chunks: Number(man.chunks ?? 0),
      bytes: Number(man.bytes ?? 0),
      nameBytes: Number(man.nameBytes ?? 0),
      savedAt: String(man.savedAt ?? ''),
    }
  } catch {
    return null
  }
}

export async function peekScanManifest(): Promise<CacheManifest | null> {
  const man = await readManifest()
  if (man) {
    const { gen: _gen, ...rest } = man
    void _gen
    return rest
  }
  // 旧格式（v3）也给 UI 一个可显示的说明
  try {
    const raw = await pixcall.storage.get('scan3-manifest')
    if (!raw) return null
    const old = JSON.parse(raw) as { libraryPath?: string; count?: number; chunkCount?: number; savedAt?: string; nameBytes?: number }
    return {
      schema: 3,
      libraryPath: String(old.libraryPath ?? ''),
      count: Number(old.count ?? 0),
      chunks: Number(old.chunkCount ?? 0),
      bytes: 0,
      nameBytes: Number(old.nameBytes ?? 0),
      savedAt: String(old.savedAt ?? ''),
    }
  } catch {
    return null
  }
}

export async function loadScan(libraryPath: string): Promise<MediaEntry[] | null> {
  const v4 = await loadV4(libraryPath)
  if (v4) return v4
  return await loadLegacy(libraryPath)
}

async function loadV4(libraryPath: string): Promise<MediaEntry[] | null> {
  const man = await readManifest()
  if (!man) return null
  if (man.libraryPath !== libraryPath) return null
  if (man.chunks <= 0 || man.count <= 0) return null
  try {
    const parentsRaw = (await pixcall.storage.get(parentsKey(man.gen))) ?? ''
    const tagsRaw = (await pixcall.storage.get(tagsKey(man.gen))) ?? ''
    const parents = parentsRaw ? parentsRaw.split('\n').filter(Boolean) : []
    const tags = tagsRaw ? tagsRaw.split('\n').filter(Boolean) : []
    const lines: string[] = []
    for (let i = 0; i < man.chunks; i++) {
      const c = await pixcall.storage.get(chunkKey(man.gen, i))
      if (c === null) return null
      lines.push(...c.split('\n'))
    }
    const out = decodeAll(lines, parents, tags)
    return out.length === man.count ? out : null
  } catch {
    return null
  }
}

/** 兼容旧 v3 缓存（scan3-*），老用户不必重扫一次 */
async function loadLegacy(libraryPath: string): Promise<MediaEntry[] | null> {
  try {
    const rawMan = await pixcall.storage.get('scan3-manifest')
    if (!rawMan) return null
    const man = JSON.parse(rawMan) as { libraryPath?: string; count?: number; chunkCount?: number }
    if (man.libraryPath !== libraryPath) return null
    const chunkCount = Number(man.chunkCount ?? 0)
    const count = Number(man.count ?? 0)
    if (chunkCount <= 0 || count <= 0) return null
    const dictRaw = await pixcall.storage.get('scan3-dict')
    if (!dictRaw) return null
    const dict = JSON.parse(dictRaw) as { parents: string[]; tags: string[] }
    const all: string[] = []
    for (let i = 0; i < chunkCount; i++) {
      const c = await pixcall.storage.get('scan3-c' + i)
      if (c === null) return null
      all.push(...c.split('\n'))
    }
    const out: MediaEntry[] = []
    for (const line of all) {
      if (!line) continue
      const f = line.split(',')
      const [id, hash, p, ts, nm] = f
      out.push({
        id,
        contentHash: hash || null,
        parentId: p === '' ? undefined : dict.parents[Number(p)],
        tagIds: ts
          ? ts
              .split('|')
              .filter((x) => x !== '')
              .map((x) => dict.tags[Number(x)])
              .filter((x): x is string => Boolean(x))
          : [],
        name: nm || '',
      })
    }
    return out.length === count ? out : null
  } catch {
    return null
  }
}

/* ══════════════ 清理 ══════════════ */

/** 删旧版本缓存；只在对应 manifest 存在时才扫分片，避免上百次无谓 IPC */
export async function deleteLegacy(): Promise<void> {
  const families = [
    { manifest: 'scan3-manifest', dict: 'scan3-dict', prefix: 'scan3-c' },
    { manifest: 'scan2-manifest', dict: 'scan2-dict', prefix: 'scan2-c' },
    { manifest: 'scan-manifest-v1', dict: '', prefix: 'scan-chunk-v1-' },
  ]
  for (const fam of families) {
    const man = await pixcall.storage.get(fam.manifest)
    if (man === null) continue
    let chunks = 300
    try {
      const parsed = JSON.parse(man) as { chunkCount?: number }
      if (Number.isFinite(Number(parsed.chunkCount))) chunks = Number(parsed.chunkCount)
    } catch {
      /* 用保守上限 */
    }
    for (let i = 0; i < chunks; i++) {
      try {
        await pixcall.storage.delete(fam.prefix + i)
      } catch {
        /* ignore */
      }
    }
    if (fam.dict) {
      try {
        await pixcall.storage.delete(fam.dict)
      } catch {
        /* ignore */
      }
    }
    try {
      await pixcall.storage.delete(fam.manifest)
    } catch {
      /* ignore */
    }
  }
  for (const k of ['entry-index-v3', 'scan.v3.dict', 'scan.v3.manifest']) {
    try {
      await pixcall.storage.delete(k)
    } catch {
      /* ignore */
    }
  }
}

async function deleteGeneration(gen: string, chunks: number): Promise<void> {
  if (!gen) return
  for (let i = 0; i < chunks + 1; i++) {
    try {
      await pixcall.storage.delete(chunkKey(gen, i))
    } catch {
      /* ignore */
    }
  }
  try {
    await pixcall.storage.delete(parentsKey(gen))
    await pixcall.storage.delete(tagsKey(gen))
  } catch {
    /* ignore */
  }
}

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.slice(0, 200)
}

/* ══════════════ 写入 ══════════════ */

/**
 * 写全库缓存。
 * 顺序：编码 → 字节预算 →（必要时删旧代腾地方）→ 写新代 → 校验 → 删旧代。
 * 失败时最多损失旧缓存（仅容量实在不够时），不会出现「先删后写失败」的必然丢数据。
 */
export async function saveScan(entries: MediaEntry[], libraryPath: string): Promise<SaveReport> {
  const t0 = Date.now()
  const gen = Date.now().toString(36)

  let prevGen = ''
  let prevChunks = 0
  let prevBytes = 0
  try {
    const raw = await pixcall.storage.get(KEY_MANIFEST)
    if (raw) {
      const man = JSON.parse(raw) as { schema?: number; gen?: string; chunks?: number; bytes?: number }
      if (man.schema === SCHEMA && typeof man.gen === 'string') {
        prevGen = man.gen
        prevChunks = Number(man.chunks ?? 0)
        prevBytes = Number(man.bytes ?? 0)
      }
    }
  } catch {
    /* ignore */
  }

  // 旧格式缓存先清掉（5MB 配额不够新旧并存）
  if ((await pixcall.storage.get('scan3-manifest')) !== null) await deleteLegacy()

  const attempts: { mode: SaveReport['mode']; nameBytes: number }[] = [
    { mode: 'full', nameBytes: 60 },
    { mode: 'short', nameBytes: 24 },
    { mode: 'noname', nameBytes: 0 },
  ]

  let last: SaveReport = {
    ok: false,
    mode: 'none',
    chunks: 0,
    bytes: 0,
    ms: 0,
    verified: false,
    nameBytes: 0,
    error: '未知原因',
  }

  for (const a of attempts) {
    const payload = encodeAll(entries, a.nameBytes)
    if (payload.bytes > BUDGET) {
      last = {
        ok: false,
        mode: a.mode,
        chunks: payload.chunks.length,
        bytes: payload.bytes,
        ms: Date.now() - t0,
        verified: false,
        nameBytes: a.nameBytes,
        error: `预估 ${(payload.bytes / 1048576).toFixed(2)}MB，超过预算 ${(BUDGET / 1048576).toFixed(1)}MB`,
      }
      continue
    }

    if (prevGen && prevBytes + payload.bytes > COEXIST_LIMIT) {
      // 旧代 + 新代放不下：先腾地方（这是唯一会损失旧缓存的时机，且清完立即写）
      await deleteGeneration(prevGen, prevChunks)
      await pixcall.storage.delete(KEY_MANIFEST)
      prevGen = ''
    }

    try {
      await pixcall.storage.set(parentsKey(gen), payload.parents)
      await pixcall.storage.set(tagsKey(gen), payload.tags)
      let written = 0
      for (let i = 0; i < payload.chunks.length; i++) {
        await pixcall.storage.set(chunkKey(gen, i), payload.chunks[i])
        written += 1
      }

      const man = {
        schema: SCHEMA,
        gen,
        libraryPath,
        count: entries.length,
        chunks: payload.chunks.length,
        bytes: payload.bytes,
        nameBytes: a.nameBytes,
        savedAt: new Date().toISOString(),
      }
      const manStr = JSON.stringify(man)
      await pixcall.storage.set(KEY_MANIFEST, manStr)

      const back = await pixcall.storage.get(KEY_MANIFEST)
      const first = await pixcall.storage.get(chunkKey(gen, 0))
      const lastChunk = await pixcall.storage.get(chunkKey(gen, payload.chunks.length - 1))
      const dictOk = payload.parents === '' || (await pixcall.storage.get(parentsKey(gen))) !== null
      const verified = back === manStr && first !== null && lastChunk !== null && dictOk
      if (!verified) {
        await deleteGeneration(gen, written)
        last = {
          ok: false,
          mode: a.mode,
          chunks: payload.chunks.length,
          bytes: payload.bytes,
          ms: Date.now() - t0,
          verified: false,
          nameBytes: a.nameBytes,
          error: '写入后读回不一致',
        }
        continue
      }

      if (prevGen) await deleteGeneration(prevGen, prevChunks)
      return {
        ok: true,
        mode: a.mode,
        chunks: payload.chunks.length,
        bytes: payload.bytes + manStr.length,
        ms: Date.now() - t0,
        verified: true,
        nameBytes: a.nameBytes,
      }
    } catch (e) {
      const msg = errText(e)
      // ★ 写失败时**只清新代**，绝不动旧代 —— 旧缓存继续可用（修 A2：先删后写失败会丢数据）
      await deleteGeneration(gen, payload.chunks.length)
      last = {
        ok: false,
        mode: a.mode,
        chunks: payload.chunks.length,
        bytes: payload.bytes,
        ms: Date.now() - t0,
        verified: false,
        nameBytes: a.nameBytes,
        error: msg,
      }
    }
  }

  return last
}
