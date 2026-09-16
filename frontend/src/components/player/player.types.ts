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

export interface ReactPlayerInstance {
  seekTo: (amount: number, type?: 'seconds' | 'fraction') => void
  getCurrentTime: () => number
  getDuration: () => number
  getInternalPlayer?: () => unknown
}

export function isHlsPlayer(player: unknown): player is HlsPlayer {
  if (typeof player !== 'object' || player === null) return false
  const candidate = player as Partial<HlsPlayer>
  return Array.isArray(candidate.levels)
    && typeof candidate.on === 'function'
    && typeof candidate.currentLevel === 'number'
}