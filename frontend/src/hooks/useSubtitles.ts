import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { SubtitleTrack } from '../components/player/player.types'

const normalizeLanguage = (value?: string | null) => (value || '').trim().toLowerCase()

export function useSubtitles(videoRef: RefObject<HTMLMediaElement | null>, providedTracks: SubtitleTrack[] = []) {
  const [nativeTracks, setNativeTracks] = useState<SubtitleTrack[]>([])
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null)
  // Once the viewer turns captions off they stay off: an automatic pick must not switch them back on.
  const captionsOffRef = useRef(false)

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

  /**
   * Viewer-driven selection.
   *
   * Turning captions off is remembered, so the automatic language pick below cannot immediately turn
   * them back on; choosing a language (or turning them on) clears that state again.
   */
  const selectLanguage = useCallback((language: string | null) => {
    captionsOffRef.current = language === null
    applyLanguage(language)
  }, [applyLanguage])

  const setNativeTrackOptions = useCallback((video: HTMLMediaElement | null) => {
    if (!video) {
      setNativeTracks((previous) => (previous.length === 0 ? previous : []))
      return
    }

    const tracks = Array.from(video.textTracks).map((track, index): SubtitleTrack => ({
      kind: track.kind === 'captions' ? 'captions' : 'subtitles',
      src: track.label || `track-${index}`,
      srcLang: track.language || track.label || `lang-${index + 1}`,
      label: track.label || track.language || `Subtitle ${index + 1}`,
      default: track.mode === 'showing',
    }))

    // The list identity stays stable while its content is unchanged: it feeds the caption choices, and
    // a fresh array on every media event would ripple through the selection effects for no reason.
    setNativeTracks((previous) => {
      const unchanged = previous.length === tracks.length && previous.every((track, index) => (
        track.kind === tracks[index].kind
        && track.src === tracks[index].src
        && track.srcLang === tracks[index].srcLang
        && track.label === tracks[index].label
      ))
      return unchanged ? previous : tracks
    })
  }, [])

  useEffect(() => {
    setNativeTrackOptions(videoRef.current)
  }, [videoRef, setNativeTrackOptions])

  useEffect(() => {
    // Subtitle renditions of an HLS manifest reach the player as provided choices rather than native
    // TextTracks, so availability — not the native track list — is what enables captions by default.
    if (!selectedLanguage && !captionsOffRef.current && choices.length > 0) {
      const nextChoice = preferredLanguage || choices[0]?.srcLang || null
      if (nextChoice) {
        startTransition(() => {
          setSelectedLanguage(nextChoice)
          applyLanguage(nextChoice)
        })
      }
      return
    }

    if (selectedLanguage && choices.length > 0) {
      const hasSelectedTrack = choices.some((track) => normalizeLanguage(track.srcLang) === normalizeLanguage(selectedLanguage))
      if (!hasSelectedTrack) {
        startTransition(() => {
          setSelectedLanguage(null)
          applyLanguage(null)
        })
      }
    }
  }, [applyLanguage, choices, preferredLanguage, selectedLanguage])

  return {
    choices,
    selectedLanguage,
    subtitlesEnabled: Boolean(selectedLanguage),
    preferredLanguage,
    applyLanguage,
    selectLanguage,
    setNativeTrackOptions,
    refreshNativeTracks: setNativeTrackOptions,
    setSelectedLanguage,
  }
}