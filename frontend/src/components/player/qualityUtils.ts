import type { HlsPlayer, HlsManifestLevel, QualityLevel } from './player.types'

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