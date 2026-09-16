import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import type { SubtitleTrack } from '../components/player/player.types'

const normalizeLanguage = (value?: string | null) => (value || '').trim().toLowerCase()

export function useSubtitles(videoRef: RefObject<HTMLMediaElement | null>, providedTracks: SubtitleTrack[] = []) {
  const [nativeTracks, setNativeTracks] = useState<SubtitleTrack[]>([])
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null)

  const choices = useMemo(() => {
    const seen = new Set<string>()
    return [...providedTracks, ...nativeTracks].filter((track) => {
      const language = normalizeLanguage(track.srcLang)
      const label = normalizeLanguage(track.label)
      if (!language || track.kind === 'metadata' || track.kind === 'chapters') return false
      const key = `${track.kind}:${language}:${label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [nativeTracks, providedTracks])

  const preferredLanguage = useMemo(() => {
    const english = choices.find((track) => /(^|[-_])(en|english)([-_]|$)/i.test(track.srcLang || track.label))
    return english?.srcLang || choices[0]?.srcLang || null
  }, [choices])

  const applyLanguage = useCallback((language: string | null) => {
    const normalized = normalizeLanguage(language)
    const selectedChoice = normalized
      ? choices.find((track) => {
          const trackLanguage = normalizeLanguage(track.srcLang)
          return trackLanguage === normalized || trackLanguage.startsWith(`${normalized}-`) || normalized.startsWith(`${trackLanguage}-`)
        })
      : undefined

    const selectedValue = selectedChoice?.srcLang || null
    const videoTracks = videoRef.current ? Array.from(videoRef.current.textTracks) : []

    videoTracks.forEach((track) => {
      const trackLanguage = normalizeLanguage(track.language || track.label)
      const isSelected = Boolean(normalized && (
        trackLanguage === normalized
        || trackLanguage.startsWith(`${normalized}-`)
        || normalized.startsWith(`${trackLanguage}-`)
      ))
      track.mode = isSelected ? 'showing' : 'disabled'
    })

    setSelectedLanguage(selectedValue)
  }, [choices, videoRef])

  const setNativeTrackOptions = useCallback((video: HTMLMediaElement | null) => {
    if (!video) {
      setNativeTracks([])
      return
    }

    const tracks = Array.from(video.textTracks).map((track, index): SubtitleTrack => ({
      kind: track.kind === 'captions' ? 'captions' : 'subtitles',
      src: track.label || `track-${index}`,
      srcLang: track.language || track.label || `lang-${index + 1}`,
      label: track.label || track.language || `Subtitle ${index + 1}`,
      default: track.mode === 'showing',
    }))

    setNativeTracks(tracks)
  }, [])

  useEffect(() => {
    setNativeTrackOptions(videoRef.current)
  }, [videoRef, setNativeTrackOptions])

  useEffect(() => {
    if (!selectedLanguage && nativeTracks.length > 0) {
      const nextChoice = preferredLanguage || choices[0]?.srcLang || null
      if (nextChoice) {
        setSelectedLanguage(nextChoice)
        applyLanguage(nextChoice)
      }
      return
    }

    if (selectedLanguage && choices.length > 0) {
      const hasSelectedTrack = choices.some((track) => normalizeLanguage(track.srcLang) === normalizeLanguage(selectedLanguage))
      if (!hasSelectedTrack) {
        setSelectedLanguage(null)
      }
    }
  }, [applyLanguage, choices, nativeTracks.length, preferredLanguage, selectedLanguage])

  return {
    choices,
    selectedLanguage,
    subtitlesEnabled: Boolean(selectedLanguage),
    preferredLanguage,
    applyLanguage,
    setNativeTrackOptions,
    refreshNativeTracks: setNativeTrackOptions,
    setSelectedLanguage,
  }
}