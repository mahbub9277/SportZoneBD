export interface SubtitleTrack {
  kind: 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata'
  src: string
  srcLang: string
  label: string
  default?: boolean
}

export interface QualityLevel {
  height: number
  bitrate: number
  hlsIndex: number
}

export interface HlsManifestLevel {
  height?: number
  bitrate?: number
  name?: string
  [key: string]: unknown
}

export type HlsLifecycleEvent =
  | 'hlsManifestLoading'
  | 'hlsManifestParsed'
  | 'hlsFragLoading'
  | 'hlsFragChanged'
  | 'hlsFragLoaded'
  | 'hlsFragBuffered'
  | 'hlsBufferAppended'
  | 'hlsLevelLoaded'
  | 'hlsLevelSwitching'
  | 'hlsBufferStalled'
  | 'hlsError'
  | 'hlsLevelSwitched'

export interface HlsEventData {
  level?: number
  fatal?: boolean
  details?: string
  reason?: string
  /** hls.js error type: `networkError`, `mediaError`, `keySystemError`, `muxError`, `otherError`. */
  type?: string
  /** Present on network errors; `code` is the HTTP status. */
  response?: { code?: number; text?: string }
  status?: number
  [key: string]: unknown
}

export interface HlsPlayer {
  levels: HlsManifestLevel[]
  on: (event: HlsLifecycleEvent | string, callback: (event: string, data: HlsEventData) => void) => void
  off?: (event: HlsLifecycleEvent | string, callback: (event: string, data: HlsEventData) => void) => void
  currentLevel: number
  autoLevelEnabled?: boolean
  stopLoad?: () => void
  detachMedia?: () => void
  destroy?: () => void
}

/**
 * The instance react-player v3 exposes through its ref.
 *
 * v3 renders the media element itself and forwards the ref to it (`hls-video` for HLS sources,
 * `video` for progressive ones), so the ref is the element — there is no v2-style player object with
 * `getInternalPlayer()`/`getDuration()`. Reaching the element through the ref is what lets the player
 * attach its own media listeners.
 */
export type ReactPlayerInstance = HTMLMediaElement

export function isHlsPlayer(player: unknown): player is HlsPlayer {
  if (typeof player !== 'object' || player === null) return false
  const candidate = player as Partial<HlsPlayer>
  return Array.isArray(candidate.levels)
    && typeof candidate.on === 'function'
    && typeof candidate.currentLevel === 'number'
}

/**
 * Resolves the hls.js instance behind a media element.
 *
 * react-player v3 plays HLS through `hls-video-element`, a custom element that extends the media
 * element API and keeps its hls.js instance on `api` (documented API of that element, with the same
 * `on()`/`levels`/`currentLevel` surface). The instance lives on that custom element, so a call with
 * the real `<video>` from its shadow root still resolves the handle. Reading it from the element is
 * what makes manifest, stall and error events observable at all — a destroyed instance reports
 * `api === null`, so callers must re-resolve it after every source load instead of caching it.
 */
export function getHlsHandle(element: unknown): HlsPlayer | null {
  if (typeof element !== 'object' || element === null) return null
  if (isHlsPlayer(element)) return element

  const candidate = (element as { api?: unknown }).api
  if (isHlsPlayer(candidate)) return candidate

  if (!(element instanceof Element)) return null
  const root = typeof element.getRootNode === 'function' ? element.getRootNode() : null
  const host = root instanceof ShadowRoot ? root.host : null
  const hostApi = host ? (host as { api?: unknown }).api : null
  return isHlsPlayer(hostApi) ? hostApi : null
}