import type { HlsPlayer, HlsManifestLevel, QualityLevel } from './player.types'

/**
 * Heights a Cloudinary-hosted progressive video (MP4/WebM highlights) can be delivered at.
 * Cloudinary renders each of these on demand from the stored asset, so they are real playable
 * renditions rather than labels for the same file.
 */
export const VOD_QUALITY_HEIGHTS = [144, 240, 360, 480, 720, 1080] as const

/**
 * Reports whether a URL points at a Cloudinary video this app may re-render at another resolution.
 * Only the /video/upload/ delivery path is accepted, so unrelated hosts and the internal stream proxy
 * are never treated as transformable.
 */
export function isCloudinaryVideoUrl(url?: string | null): boolean {
  if (typeof url !== 'string' || !url.trim()) return false

  try {
    const parsed = new URL(url.trim())
    return parsed.hostname.includes('cloudinary.com') && /\/video\/upload\//.test(parsed.pathname)
  } catch {
    return false
  }
}

/**
 * Builds the quality options a progressive source can actually deliver.
 *
 * The delivered source height is the asset's own height, so only resolutions at or below it are
 * offered: asking Cloudinary for a larger height would silently return the source height and the
 * label would be a lie. An unknown height means no options at all rather than guessed ones.
 *
 * Callers must pass the source's own height, not the height of a rendition currently being played,
 * otherwise choosing a lower quality would hide the higher ones.
 */
export function buildVodQualityLevels(sourceHeight: number): QualityLevel[] {
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) return []

  return VOD_QUALITY_HEIGHTS
    .filter((height) => height <= sourceHeight)
    .map((height, index) => ({ height, bitrate: 0, hlsIndex: index }))
}

export function normalizeQualityLevels(levels: HlsManifestLevel[] | undefined): QualityLevel[] {
  if (!Array.isArray(levels) || levels.length === 0) return []

  const normalized = levels
    .map((level, hlsIndex) => {
      const height = typeof level.height === 'number' ? level.height : Number(level.height)
      const bitrate = typeof level.bitrate === 'number' ? level.bitrate : Number(level.bitrate)
      return {
        hlsIndex,
        height: Number.isFinite(height) ? Math.max(0, height) : 0,
        bitrate: Number.isFinite(bitrate) ? Math.max(0, bitrate) : 0,
      }
    })
    .filter((level) => level.height > 0)
    .sort((a, b) => a.height - b.height)

  const bestByHeight = new Map<number, QualityLevel>()
  normalized.forEach((level) => {
    const existing = bestByHeight.get(level.height)
    if (!existing || level.bitrate > existing.bitrate) {
      bestByHeight.set(level.height, level)
    }
  })

  return [...bestByHeight.values()].sort((a, b) => a.height - b.height)
}

export function getActualHlsCurrentLevel(hlsPlayer: HlsPlayer, fallbackLevels: QualityLevel[] = []): number {
  const currentLevel = Number.isFinite(hlsPlayer.currentLevel) ? hlsPlayer.currentLevel : -1

  if (currentLevel === -1) return -1
  if (fallbackLevels.length === 0) return currentLevel

  const matchedLevel = fallbackLevels.find((level) => level.hlsIndex === currentLevel)
  if (matchedLevel) return matchedLevel.hlsIndex

  return fallbackLevels.find((level) => level.height === currentLevel)?.hlsIndex ?? -1
}