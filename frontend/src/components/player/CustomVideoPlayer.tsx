import React, { startTransition, useState, useRef, useEffect, useCallback, useMemo, useReducer } from 'react'
import { Unlock, Tv, RotateCcw, AlertCircle, Server } from 'lucide-react'

import { motion, AnimatePresence } from 'framer-motion'
import { TooltipProvider } from '../ui/Tooltip'
import { useHlsPlayer } from '../../hooks/useHlsPlayer'
import { usePerformanceProfile } from '../../hooks/usePerformanceProfile'
import { useSocket } from '../../hooks/useSocket'
import { usePlayerTelemetry } from '../../hooks/usePlayerTelemetry'
import { useAutoHideControls } from '../../hooks/useAutoHideControls'
import { useSubtitles } from '../../hooks/useSubtitles'
import { useFullscreen } from '../../hooks/useFullscreen'
import { usePictureInPicture } from '../../hooks/usePictureInPicture'
import { useVideoLifecycle } from '../../hooks/useVideoLifecycle'
import { SportZoneBDLoader } from '../ui/SportZoneBDLoader'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { PlayerControls, type MatchPlayerMetadata } from './PlayerControls'
import { NoSignalOverlay } from './NoSignalOverlay'
import { getPlayerContainerClass } from './playerLayout'
import { buildVodQualityLevels, getActualHlsCurrentLevel, isCloudinaryVideoUrl, normalizeQualityLevels } from './qualityUtils'
import { getHlsHandle, isHlsPlayer, type HlsEventData, type HlsManifestLevel, type HlsPlayer, type QualityLevel, type ReactPlayerInstance, type SubtitleTrack } from './player.types'
import {
  classifyHlsError,
  classifyMediaError,
  classifyPlaybackException,
  createPlaybackWatchdog,
  hasStartedPlayback,
  initialPlaybackLifecycle,
  isTerminalPlaybackStatus,
  playbackErrorMessage,
  playbackExhaustedMessage,
  playbackLifecycleReducer,
  playbackLoaderLabel,
  playbackLoaderVariant,
  type PlaybackFailure,
  type PlaybackLifecycleAction,
  type PlaybackLifecycleState,
  type PlaybackWatchdog,
} from './playerLifecycle'

export type { SubtitleTrack } from './player.types'

/**
 * The playable media element behind the react-player instance.
 *
 * react-player v3 takes `RefAttributes<HTMLVideoElement>` and hands its ref the element it renders,
 * unlike v2 which exposed a player object with `getInternalPlayer()`. For HLS that element is
 * `hls-video`, a custom element that extends `HTMLElement` (not a media element) and renders the real
 * `<video>` — the element that owns the MSE source, fires the media events and supports Picture-in-
 * Picture — inside its shadow root. Progressive sources render a plain `<video>`.
 */
const resolveMediaElement = (candidate: unknown): HTMLMediaElement | null => {
  if (candidate instanceof HTMLMediaElement) return candidate

  const wrapper = candidate as { getInternalPlayer?: () => unknown } | null | undefined
  const internal = typeof wrapper?.getInternalPlayer === 'function' ? wrapper.getInternalPlayer() : null
  if (internal instanceof HTMLMediaElement) return internal

  if (!(candidate instanceof Element)) return null
  const shadowVideo = candidate.shadowRoot?.querySelector('video')
  return shadowVideo instanceof HTMLMediaElement ? shadowVideo : null
}

export interface CustomVideoPlayerProps {
  url?: string | null
  /**
   * The id of a **stream** record. It is the only thing that enables the manifest proxy
   * (`/api/v1/stream/proxy`), which resolves it against the stream table, so a channel or match id
   * must never be passed here — those play `url` directly and are identified by `channelId`/`matchId`.
   */
  streamId?: string
  presenceId?: string
  presenceType?: 'stream' | 'channel' | 'match'
  matchId?: string
  channelId?: string
  title?: string
  poster?: string
  autoPlay?: boolean
  compactControls?: boolean
  onPlayerError?: (message: string) => void
  onStopReady?: (stop: (() => void) | null) => void
  /**
   * Asks the owner of the source list for the next stream candidate after the current one failed.
   * Returning true means a new URL was applied (the player then waits for it); returning false means
   * the candidate list is exhausted and the player reports a terminal error.
   */
  onStreamFallback?: (failedUrl: string) => boolean
  subtitles?: SubtitleTrack[];
  matchMetadata?: MatchPlayerMetadata
  /**
   * Whether the player installs its document-level keyboard shortcuts (Space, arrows, F, M, P).
   *
   * TV Mode owns the arrow keys for D-pad navigation, so it switches these off and drives playback
   * through `onTransportReady` instead. Every other surface keeps them, which is why this defaults to on.
   */
  globalShortcuts?: boolean
  /** Publishes the transport controls so a host (TV Mode) can drive play/pause from outside the player. */
  onTransportReady?: (transport: { playPause: () => void; isPlaying: boolean } | null) => void
}

type ReactPlayerModule = typeof import('react-player')
type ReactPlayerProps = React.ComponentPropsWithoutRef<NonNullable<ReactPlayerModule['default']>>

const LazyReactPlayer = React.lazy(async () => {
  const mod = await import('react-player')
  return { default: mod.default }
})

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const LOW_POWER_PLAYBACK_RATES = [0.75, 1, 1.25]

function writeRef<T>(ref: { current: T }, value: T) {
  ref.current = value
}

/**
 * Length of the media window the browser currently holds at the playhead.
 *
 * Only the contiguous range containing the playhead is counted — or the next range when the playhead
 * sits in a gap, for example right after seeking past the buffer. Summing every range would count
 * discontiguous or stale fragments that cannot be played through from the current position, which
 * would report a loaded amount larger than the media actually available there.
 */
function getLoadedWindowSeconds(ranges: TimeRanges, currentTime: number): number {
  if (!ranges || ranges.length === 0) return 0

  let selectedRange = -1
  for (let index = 0; index < ranges.length; index += 1) {
    if (currentTime >= ranges.start(index) && currentTime <= ranges.end(index)) {
      selectedRange = index
      break
    }
  }

  if (selectedRange === -1) {
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges.start(index) >= currentTime) {
        selectedRange = index
        break
      }
    }
  }

  if (selectedRange === -1) selectedRange = ranges.length - 1

  const windowLength = ranges.end(selectedRange) - ranges.start(selectedRange)
  return Number.isFinite(windowLength) && windowLength > 0 ? windowLength : 0
}

/**
 * The subtitle renditions hls.js reports for the current manifest.
 *
 * Only real `#EXT-X-MEDIA:TYPE=SUBTITLES` entries become choices — a source without them simply has no
 * caption options, and nothing is invented for it.
 */
function mapHlsSubtitleTracks(tracks?: HlsManifestLevel[]): SubtitleTrack[] {
  if (!Array.isArray(tracks)) return []

  return tracks
    .filter((track) => typeof track?.lang === 'string' && track.lang.length > 0)
    .map((track, index) => ({
      kind: 'subtitles' as const,
      src: typeof track.url === 'string' && track.url ? track.url : `hls-subtitle-${index}`,
      srcLang: String(track.lang),
      label: typeof track.name === 'string' && track.name ? track.name : String(track.lang),
    }))
}

function areSubtitleTrackListsEqual(current: SubtitleTrack[], next: SubtitleTrack[]): boolean {
  if (current.length !== next.length) return false
  return current.every((track, index) => (
    track.src === next[index].src && track.srcLang === next[index].srcLang && track.label === next[index].label
  ))
}

interface PlayerState {
  isPlaying: boolean; volume: number; isMuted: boolean; played: number; duration: number; isSeeking: boolean; isFullscreen: boolean; controlsVisible: boolean; isSettingsOpen: boolean; playerError: string | null; playbackRate: number
}
type SettingsSection = 'root' | 'quality' | 'playback' | 'captions'
interface LiveWindowState { hasTimeshift: boolean; liveStart: number; liveEdge: number; currentTime: number; isLive: boolean }
type PlayerAction =
  | { type: 'TOGGLE_PLAY' }
  | { type: 'SET_PLAYING'; payload: boolean }
  | { type: 'SET_VOLUME'; payload: number }
  | { type: 'SET_PLAYED'; payload: number }
  | { type: 'SET_DURATION'; payload: number }
  | { type: 'SET_SEEKING'; payload: boolean }
  | { type: 'SET_FULLSCREEN'; payload: boolean }
  | { type: 'SET_CONTROLS_VISIBLE'; payload: boolean }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'RESET_FOR_NEW_URL'; payload: boolean }
  | { type: 'SET_PLAYBACK_RATE'; payload: number }

const initialPlayerState: PlayerState = {
  isPlaying: false,
  volume: 0.8,
  isMuted: false,
  played: 0,
  duration: 0,
  isSeeking: false,
  isFullscreen: false,
  controlsVisible: true,
  isSettingsOpen: false,
  playerError: null,
  playbackRate: 1,
};

const playerReducer = (state: PlayerState, action: PlayerAction): PlayerState => {
  switch (action.type) {
    case 'TOGGLE_PLAY':
      return { ...state, isPlaying: !state.isPlaying };
    case 'SET_PLAYING':
      return { ...state, isPlaying: action.payload };
    case 'SET_VOLUME':
      return { ...state, volume: action.payload, isMuted: action.payload === 0 };
    case 'SET_PLAYED':
      return { ...state, played: action.payload };
    case 'SET_DURATION':
      return { ...state, duration: action.payload };
    case 'SET_SEEKING':
      return { ...state, isSeeking: action.payload };
    case 'SET_FULLSCREEN':
      return { ...state, isFullscreen: action.payload };
    case 'SET_CONTROLS_VISIBLE':
      return { ...state, controlsVisible: action.payload };
    case 'TOGGLE_SETTINGS':
      return { ...state, isSettingsOpen: !state.isSettingsOpen };
    case 'SET_ERROR':
      return { ...state, playerError: action.payload };
    case 'RESET_FOR_NEW_URL':
      return { ...initialPlayerState, isPlaying: action.payload };
    case 'SET_PLAYBACK_RATE':
      return { ...state, playbackRate: action.payload };
    default:
      return state;
  }
}

export function CustomVideoPlayer({
  url,
  streamId,
  title,
  poster,
  autoPlay = false,
  compactControls = false,
  onPlayerError,
  onStopReady,
  onStreamFallback,
  subtitles,
  presenceId,
  presenceType = 'stream',
  matchId,
  channelId,
  matchMetadata,
  globalShortcuts = true,
  onTransportReady,
}: CustomVideoPlayerProps) {
  const { socket } = useSocket()
  const { deviceTier, networkQuality, shouldReduceEffects, isSmartTV, reducedMotion } = usePerformanceProfile()
  const isLowPower = deviceTier === 'low' || shouldReduceEffects
  const playerRef = useRef<ReactPlayerInstance | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  const [state, dispatch] = useReducer(playerReducer, {
    ...initialPlayerState,
    isPlaying: autoPlay,
  });
  const { isPlaying, volume, isMuted, played, duration, isSeeking, isFullscreen, controlsVisible, isSettingsOpen, playerError, playbackRate } = state;

  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([])
  const [currentLevel, setCurrentLevel] = useState<number>(-1) // -1 for Auto
  // Progressive (MP4/WebM) highlights switch quality by requesting a real Cloudinary rendition, so
  // the selected height is remembered here and applied to the delivered source URL.
  const [manualVideoHeight, setManualVideoHeight] = useState<number | null>(null)
  const [sourceVideoHeight, setSourceVideoHeight] = useState(0)
  const [bufferedAmount, setBufferedAmount] = useState(0)
  const pendingResumeRef = useRef<{ time: number; wasPlaying: boolean } | null>(null)
  const lastDurationRef = useRef(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const refreshKeyRef = useRef(0)
  const refreshPlayer = useCallback(() => {
    const nextKey = refreshKeyRef.current + 1
    refreshKeyRef.current = nextKey
    setRefreshKey(nextKey)
  }, [])
  // Tracks whether the player has attached a live media element. It also gates Picture-in-Picture
  // support detection, which can only be decided once that element exists.
  const [hasNativeMediaReady, setHasNativeMediaReady] = useState(false)
  // Subtitle renditions of the current HLS manifest: they are the only captions a channel can really
  // offer, so the caption menu lists exactly these and nothing else.
  const [hlsSubtitleTracks, setHlsSubtitleTracks] = useState<SubtitleTrack[]>([])
  const [qualityToast, setQualityToast] = useState<string | null>(null)
  const { currentUrl, retry, reset: resetFallbackState, setError } = useHlsPlayer(url, streamId)
  const sourceKey = `${streamId || ''}|${url || ''}`
  // The single authoritative playback lifecycle: every media/HLS/timer signal feeds this reducer and
  // the loader, the error copy and the recovery decisions all read from it.
  const [lifecycle, lifecycleDispatch] = useReducer(playbackLifecycleReducer, sourceKey, initialPlaybackLifecycle)
  const lifecycleRef = useRef<PlaybackLifecycleState>(lifecycle)
  const [mediaElement, setMediaElement] = useState<HTMLMediaElement | null>(null)
  const draggingTrackRef = useRef<HTMLDivElement | null>(null)
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>('root')
  const [isLocked, setIsLocked] = useState(false)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [isPointerInsidePlayer, setIsPointerInsidePlayer] = useState(false)
  const [liveWindow, setLiveWindow] = useState<LiveWindowState>({
    hasTimeshift: false,
    liveStart: 0,
    liveEdge: 0,
    currentTime: 0,
    isLive: false,
  })
  const videoElementRef = useRef<HTMLMediaElement | null>(null)
  /**
   * Publishes the media element react-player rendered.
   *
   * This is the only dependable trigger for HLS: `hls-video` starts loading inside its own
   * `connectedCallback` and re-dispatches media events from its shadow root, but it never surfaces the
   * `loadstart` that react-player turns into `onReady` — so the adapter would never learn about the
   * element and the initial loader could never clear. React's ref is handed the element at commit time,
   * which is the same node react-player would report.
   */
  const handlePlayerRef = useCallback((node: HTMLVideoElement | null) => {
    playerRef.current = node
    const media = resolveMediaElement(node)
    if (media) videoElementRef.current = media
    startTransition(() => setMediaElement(media))
  }, [])
  const timelineInputRef = useRef<HTMLInputElement | null>(null)
  const timelineProgressRef = useRef<HTMLDivElement | null>(null)
  const timelineBufferedRef = useRef<HTMLDivElement | null>(null)
  const timelineSeekableRef = useRef<HTMLDivElement | null>(null)
  const lastMediaTimeRef = useRef<number | null>(null)
  const prevVolumeRef = useRef(0.8)
  const volumePointerCleanupRef = useRef<(() => void) | null>(null)
  const hlsRef = useRef<HlsPlayer | null>(null)
  const sourceGenerationRef = useRef(0)
  const manualQualityRef = useRef(false)
  const currentSourceKeyRef = useRef(sourceKey)
  const terminatedRef = useRef(false)
  const previousSourceKeyRef = useRef(sourceKey)
  const qualityToastTimeoutRef = useRef<number | null>(null)
  const presenceActiveRef = useRef(false)
  const presenceKeyRef = useRef<string | null>(null)
  const suppressAutoplayOnSourceChangeRef = useRef(false)
  /**
   * Whether the viewer wants the stream running.
   *
   * The `isPlaying` state follows media events, and the player's own teardown pauses the element, so it
   * cannot answer "should this resume?" after a retry: it would always look paused. Intent therefore
   * only changes when the viewer plays, pauses or finishes a stream.
   */
  const playIntentRef = useRef(autoPlay)
  const selectedSubtitleLanguageRef = useRef<string | null>(null)
  /**
   * Play intent carried into the next candidate of a failed source, consumed by the source reset.
   *
   * Only recovery sets it: an ordinary source switch keeps its existing autoplay behaviour.
   */
  const recoveryIntentRef = useRef(false)
  const presenceIdentity = presenceId || streamId || null
  const { track: trackTelemetry } = usePlayerTelemetry({
    streamId,
    channelId: channelId || (presenceType === 'channel' ? presenceId : undefined),
    matchId,
    active: isPlaying,
  })

  // ---------------------------------------------------------------- playback lifecycle wiring

  /** True while the callbacks belong to the source that is still the current one. */
  const isCurrentSource = useCallback(() => !terminatedRef.current && currentSourceKeyRef.current === sourceKey, [sourceKey])

  /**
   * Dispatches through the reducer and keeps a synchronously readable mirror, so a recovery decision
   * taken inside an event callback can never act on a stale status.
   */
  const dispatchLifecycle = useCallback((action: PlaybackLifecycleAction) => {
    lifecycleRef.current = playbackLifecycleReducer(lifecycleRef.current, action)
    lifecycleDispatch(action)
  }, [])

  const hlsCleanupRef = useRef<(() => void) | null>(null)
  const watchdogRef = useRef<PlaybackWatchdog | null>(null)
  const watchdogTimeoutHandlerRef = useRef<() => void>(() => {})
  const mediaReadyHandlerRef = useRef<() => void>(() => {})
  /**
   * Set while a manual quality change reloads the same element with a new rendition.
   *
   * The rendition keeps the same source key, so readiness is only accepted once the element reports the
   * new load (it is back at its start) — a late `canplay` from the rendition being replaced cannot clear
   * the loader for the new one.
   */
  const awaitingRenditionReloadRef = useRef(false)
  const failureHandlerRef = useRef<(failure: PlaybackFailure, telemetryEvent?: 'network_error' | 'media_error' | 'fatal_error' | 'playback_timeout') => void>(() => {})
  const fallbackRequestedUrlRef = useRef<string | null>(null)

  const getWatchdog = useCallback(() => {
    watchdogRef.current ??= createPlaybackWatchdog({ onTimeout: () => watchdogTimeoutHandlerRef.current() })
    return watchdogRef.current
  }, [])

  // `stopPlayback` is defined after the recovery flow, and it must always be the current version.
  const stopPlaybackRef = useRef<() => void>(() => {})

  const noteProgress = useCallback(() => {
    if (!isCurrentSource()) return
    const { status } = lifecycleRef.current
    // Only the initial load needs progress bookkeeping; during playback the media events drive the UI.
    if (status !== 'loading' && status !== 'retrying') return
    dispatchLifecycle({ type: 'PROGRESS', sourceKey })
  }, [dispatchLifecycle, isCurrentSource, sourceKey])

  const clearPlayerError = useCallback(() => {
    dispatch({ type: 'SET_ERROR', payload: null })
  }, [])

  const clearQualityToast = useCallback(() => {
    if (qualityToastTimeoutRef.current !== null) {
      window.clearTimeout(qualityToastTimeoutRef.current)
      qualityToastTimeoutRef.current = null
    }
    setQualityToast(null)
  }, [])

  const showQualityToast = useCallback((message: string) => {
    if (qualityToastTimeoutRef.current !== null) window.clearTimeout(qualityToastTimeoutRef.current)
    setQualityToast(message)
    qualityToastTimeoutRef.current = window.setTimeout(() => {
      qualityToastTimeoutRef.current = null
      setQualityToast(null)
    }, 2200)
  }, [])

  const leaveViewerPresence = useCallback(() => {
    if (!presenceActiveRef.current || !presenceIdentity || !socket) return
    socket.emit('leaveStream', { streamId: presenceIdentity, kind: presenceType })
    presenceActiveRef.current = false
  }, [presenceIdentity, presenceType, socket])

  const joinViewerPresence = useCallback(() => {
    if (presenceActiveRef.current || !presenceIdentity || !socket?.connected) return
    socket.emit('joinStream', { streamId: presenceIdentity, kind: presenceType })
    presenceActiveRef.current = true
  }, [presenceIdentity, presenceType, socket])

  useEffect(() => {
    const nextKey = presenceIdentity ? `${presenceType}:${presenceIdentity}` : null
    if (presenceKeyRef.current !== null && presenceKeyRef.current !== nextKey) leaveViewerPresence()
    presenceKeyRef.current = nextKey
  }, [leaveViewerPresence, presenceIdentity, presenceType])

  useEffect(() => {
    if (!socket) return
    const handleConnect = () => {
      if (presenceActiveRef.current && presenceIdentity) {
        socket.emit('joinStream', { streamId: presenceIdentity, kind: presenceType })
      }
    }
    socket.on('connect', handleConnect)
    return () => {
      socket.off('connect', handleConnect)
    }
  }, [presenceIdentity, presenceType, socket])

  /**
   * The bounded recovery path for a failure of the current source.
   *
   * 1. the same source's other transport (proxy backup, then direct URL) when one is still untried,
   * 2. otherwise the next candidate from the owner of the source list — at most once per failed URL,
   * 3. otherwise a terminal error state, which always replaces the loader.
   */
  const handlePlaybackFailure = useCallback((
    failure: PlaybackFailure,
    telemetryEvent?: 'network_error' | 'media_error' | 'fatal_error' | 'playback_timeout' | 'playback_invalid_stream',
  ) => {
    if (!failure.fatal || !isCurrentSource()) return
    // A second event for the same failed source must not re-enter recovery (media + hls.js can both
    // report the same failure) nor replace an already terminal error.
    if (isTerminalPlaybackStatus(lifecycleRef.current.status)) return

    if (import.meta.env.DEV) {
      console.warn('[player] source failed', { kind: failure.kind, detail: failure.detail, status: failure.status })
    }
    const event = telemetryEvent ?? (
      failure.kind === 'timeout' ? 'playback_timeout'
        : failure.kind === 'invalid_stream' ? 'playback_invalid_stream'
          : failure.kind === 'network' ? 'network_error'
            : failure.kind === 'decoder' || failure.kind === 'media' ? 'media_error'
              : 'fatal_error'
    )
    // Recovery is a continuation of the stream the viewer was watching, so the intent and the position
    // are read before the teardown pauses the element. Without this the automatic transport retry
    // reloaded the source and left it paused at the start.
    const video = videoElementRef.current
    const resumeIntent = playIntentRef.current
    const resumeTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0
    const isLiveSource = !video || !Number.isFinite(video.duration)

    trackTelemetry(event, { kind: failure.kind, ...(failure.detail ? { detail: failure.detail } : {}), ...(failure.status ? { status: failure.status } : {}) })
    dispatchLifecycle({ type: 'FAILED', sourceKey, kind: failure.kind })

    if (retry()) {
      // A retry is a new load of the same source, so the previous element, its hls.js instance and all
      // their listeners are released before the replacement is created — and the same position and play
      // intent are restored by the resume mechanism, exactly as an explicit retry does.
      writeRef(pendingResumeRef, resumeIntent && !isLiveSource && resumeTime > 0.05 ? { time: resumeTime, wasPlaying: true } : null)
      dispatch({ type: 'SET_PLAYING', payload: resumeIntent })
      stopPlaybackRef.current()
      terminatedRef.current = false
      currentSourceKeyRef.current = sourceKey
      awaitingRenditionReloadRef.current = false
      clearPlayerError()
      trackTelemetry('playback_retry')
      dispatchLifecycle({ type: 'RETRY', sourceKey })
      refreshPlayer()
      return
    }

    const failedUrl = typeof url === 'string' ? url.trim() : ''
    if (failedUrl && fallbackRequestedUrlRef.current !== failedUrl && onStreamFallback?.(failedUrl)) {
      fallbackRequestedUrlRef.current = failedUrl
      // The next candidate is a different source, so only the intent is carried over: the new source
      // decides whether the previous position is valid at all.
      writeRef(recoveryIntentRef, resumeIntent)
      clearPlayerError()
      trackTelemetry('playback_fallback')
      dispatchLifecycle({ type: 'AWAIT_CANDIDATE', sourceKey })
      return
    }

    trackTelemetry('playback_exhausted')
    dispatchLifecycle({ type: 'EXHAUSTED', sourceKey })
    leaveViewerPresence()
    const message = onStreamFallback ? playbackExhaustedMessage() : playbackErrorMessage(failure.kind)
    setError(message)
    dispatch({ type: 'SET_ERROR', payload: message })
    if (typeof onPlayerError === 'function') onPlayerError(message)
  }, [clearPlayerError, dispatch, dispatchLifecycle, isCurrentSource, leaveViewerPresence, onPlayerError, onStreamFallback, refreshPlayer, retry, setError, sourceKey, trackTelemetry, url])

  useEffect(() => {
    failureHandlerRef.current = handlePlaybackFailure
  }, [handlePlaybackFailure])

  /** A no-progress initial load ends in the same bounded recovery path as an explicit error. */
  const handleWatchdogTimeout = useCallback(() => {
    if (!isCurrentSource()) return
    handlePlaybackFailure({ kind: 'timeout', fatal: true, detail: 'noProgress' }, 'playback_timeout')
  }, [handlePlaybackFailure, isCurrentSource])

  useEffect(() => {
    watchdogTimeoutHandlerRef.current = handleWatchdogTimeout
  }, [handleWatchdogTimeout])

  // The watchdog is armed only while the current attempt has no playable data, and is re-armed by every
  // progress signal (progressCount). Readiness, errors, retries and unmount all disarm it.
  useEffect(() => {
    const watchdog = getWatchdog()
    if (lifecycle.status === 'loading' || lifecycle.status === 'retrying') watchdog.arm()
    else watchdog.disarm()
    return () => watchdog.disarm()
  }, [getWatchdog, lifecycle.progressCount, lifecycle.status, sourceKey])

  useEffect(() => () => {
    hlsCleanupRef.current?.()
    hlsCleanupRef.current = null
  }, [])

  const playbackRates = useMemo(
    () => (isLowPower ? LOW_POWER_PLAYBACK_RATES : PLAYBACK_RATES),
    [isLowPower]
  )
  // Caption options come from two real sources only: the tracks the caller provides and the subtitle
  // renditions of the current HLS manifest. Native TextTracks of the loaded media are merged in by the
  // hook itself, which de-duplicates them against these entries.
  const subtitleTrackChoices = useMemo(
    () => [...(subtitles ?? []), ...hlsSubtitleTracks],
    [hlsSubtitleTracks, subtitles],
  )
  const { choices: subtitleChoices, selectedLanguage: selectedSubtitleLanguage, subtitlesEnabled, preferredLanguage, applyLanguage: applySubtitleLanguage, selectLanguage: selectSubtitleLanguage, refreshNativeTracks } = useSubtitles(videoElementRef, subtitleTrackChoices)
  const { isFullscreen: isFullscreenFromHook, toggle: toggleFullscreen } = useFullscreen(playerContainerRef, isTouchDevice)
  const { isActive: isPiPActive, isSupported: isPiPSupported, toggle: togglePictureInPicture } = usePictureInPicture(videoElementRef, hasNativeMediaReady)

  useEffect(() => {
    dispatch({ type: 'SET_FULLSCREEN', payload: isFullscreenFromHook })
  }, [dispatch, isFullscreenFromHook])

  const setControlsVisible = useCallback((visible: boolean) => {
    dispatch({ type: 'SET_CONTROLS_VISIBLE', payload: visible })
  }, [])
  const { show: showControls, hide: hideControls, toggle: toggleControls } = useAutoHideControls({
    isPlaying,
    isVisible: controlsVisible,
    isSeeking,
    isSettingsOpen,
    hasError: !!playerError,
    isTouchDevice,
    isPointerInside: isPointerInsidePlayer,
    setVisible: setControlsVisible,
  })

  const handlePlayerPointerEnter = useCallback(() => {
    if (isTouchDevice || isSettingsOpen) return
    setIsPointerInsidePlayer(true)
    showControls()
  }, [isSettingsOpen, isTouchDevice, showControls])

  const handlePlayerPointerMove = useCallback(() => {
    if (isTouchDevice || isSettingsOpen) return
    setIsPointerInsidePlayer(true)
    showControls()
  }, [isSettingsOpen, isTouchDevice, showControls])

  const handlePlayerPointerLeave = useCallback(() => {
    setIsPointerInsidePlayer(false)
    if (isPlaying && !isTouchDevice) {
      hideControls()
    }
  }, [hideControls, isPlaying, isTouchDevice])

  const getVideoElement = useCallback(() => { // Changed to use useCallback
    if (videoElementRef.current) {
      return videoElementRef.current
    }

    const internalPlayer = resolveMediaElement(playerRef.current)
    const nativeVideo = internalPlayer instanceof HTMLMediaElement ? internalPlayer : null

    if (nativeVideo) {
      videoElementRef.current = nativeVideo
      return nativeVideo
    }

    const renderedVideo = playerContainerRef.current?.querySelector('video')
    if (renderedVideo instanceof HTMLMediaElement) {
      videoElementRef.current = renderedVideo
      return renderedVideo
    }

    return null
  }, [])

  const stopPlayback = useCallback(() => {
    if (terminatedRef.current && !playerRef.current && !hlsRef.current && !videoElementRef.current) {
      return
    }

    const activeHls = hlsRef.current

    let internalPlayer: unknown = activeHls
    try {
      internalPlayer = activeHls || resolveMediaElement(playerRef.current) || null
    } catch {
      internalPlayer = activeHls
    }

    const videos = new Set<HTMLMediaElement>()
    if (videoElementRef.current) videos.add(videoElementRef.current)
    if (internalPlayer instanceof HTMLMediaElement) videos.add(internalPlayer)
    playerContainerRef.current?.querySelectorAll('video, hls-video').forEach((video) => videos.add(video as HTMLMediaElement))

    const previousGeneration = sourceGenerationRef.current
    const previousSource = currentSourceKeyRef.current

    terminatedRef.current = true
    currentSourceKeyRef.current = ''
    sourceGenerationRef.current += 1

    clearQualityToast()
    startTransition(() => setHasNativeMediaReady(false))
    volumePointerCleanupRef.current?.()
    volumePointerCleanupRef.current = null
    draggingTrackRef.current = null
    if (tapTimeoutRef.current !== null) {
      window.clearTimeout(tapTimeoutRef.current)
      writeRef(tapTimeoutRef, null)
    }
    writeRef(lastTouchRef, null)
    leaveViewerPresence()
    trackTelemetry('player_destroyed')

    // Every listener set belongs to the source being released: the media adapter follows the element
    // state, and the hls.js listeners are dropped here so a late event of a destroyed instance can
    // never reach the current lifecycle.
    hlsCleanupRef.current?.()
    hlsCleanupRef.current = null
    hlsRef.current = null
    watchdogRef.current?.disarm()
    startTransition(() => setMediaElement(null))

    if (isHlsPlayer(internalPlayer)) {
      try {
        internalPlayer.stopLoad?.()
        internalPlayer.detachMedia?.()
        internalPlayer.destroy?.()
      } catch {
        // Ignore HLS destroy errors during shutdown. The media element is still released below.
      }
    } else if (internalPlayer && typeof (internalPlayer as { destroy?: () => void }).destroy === 'function') {
      try {
        ;(internalPlayer as { destroy: () => void }).destroy()
      } catch {
        // Ignore destroy failures during shutdown.
      }
    }

    videos.forEach((video) => {
      try {
        video.pause()
        video.removeAttribute('src')
        video.srcObject = null
        video.load()
      } catch {
        // Ignore errors during cleanup.
      }
    })

    videoElementRef.current = null
    playerRef.current = null

    if (typeof window !== 'undefined') {
      window.clearTimeout(qualityToastTimeoutRef.current ?? undefined)
      qualityToastTimeoutRef.current = null
    }

    if (previousGeneration === sourceGenerationRef.current) {
      sourceGenerationRef.current += 1
    }

    if (previousSource) {
      currentSourceKeyRef.current = ''
    }
  }, [clearQualityToast, leaveViewerPresence, trackTelemetry])

  useEffect(() => {
    stopPlaybackRef.current = stopPlayback
  }, [stopPlayback])

  useEffect(() => {
    if (!onStopReady) return

    onStopReady(stopPlayback)
    return () => {
      onStopReady(null)
    }
  }, [onStopReady, stopPlayback])

  const getLastTimeRange = useCallback((ranges: TimeRanges) => { // Changed to use useCallback
    if (!ranges.length) return null
    const index = ranges.length - 1
    return { start: ranges.start(index), end: ranges.end(index) }
  }, [])

  const updateTimelineDom = useCallback(() => {
    const video = getVideoElement()
    if (!video) return

    const seekable = getLastTimeRange(video.seekable)
    const buffered = getLastTimeRange(video.buffered)
    const timelineStart = seekable && typeof seekable.start === 'number' ? seekable.start : 0
    const timelineEnd = seekable && typeof seekable.end === 'number' ? seekable.end : (Number.isFinite(video.duration) ? video.duration : 0)
    const span = Math.max(timelineEnd - timelineStart, 0)
    const currentRatio = span > 0
      ? Math.min(1, Math.max(0, (video.currentTime - timelineStart) / span))
      : 0

    if (timelineInputRef.current) {
      timelineInputRef.current.value = String(currentRatio)
      timelineInputRef.current.disabled = span <= 0 || (!seekable && !Number.isFinite(video.duration))
    }

    if (timelineProgressRef.current) {
      timelineProgressRef.current.style.width = `${currentRatio * 100}%`
    }

    if (timelineSeekableRef.current) {
      timelineSeekableRef.current.style.left = seekable ? '0%' : '0%'
      timelineSeekableRef.current.style.width = seekable ? '100%' : '0%'
    }

    if (timelineBufferedRef.current) {
      const bufferedStart = buffered ? Math.max(timelineStart, buffered.start) : timelineStart
      const bufferedEnd = buffered ? Math.min(timelineEnd, buffered.end) : timelineStart
      const bufferedLeft = span > 0 ? Math.max(0, ((bufferedStart - timelineStart) / span) * 100) : 0
      const bufferedWidth = span > 0 ? Math.max(0, ((bufferedEnd - bufferedStart) / span) * 100) : 0
      timelineBufferedRef.current.style.left = `${bufferedLeft}%`
      timelineBufferedRef.current.style.width = `${bufferedWidth}%`
    }
  }, [getLastTimeRange, getVideoElement])

  /**
   * Keeps duration, buffered amount and source resolution in step with the media element.
   *
   * This runs from the existing media events (loadedmetadata, durationchange, progress, timeupdate,
   * canplay) and from the same poll that already refreshes the timeline, so metadata that only
   * becomes available after the initial render — or after a source or quality change — is picked up
   * without adding another timer or listener set. A live stream reports no finite duration, so the
   * duration stays unknown there and the buffered amount is what the controller shows instead.
   */
  const syncMediaMetrics = useCallback((video: HTMLMediaElement) => {
    // Readiness is level-triggered from the element itself rather than from one event: at
    // HAVE_CURRENT_DATA the position being played has data, so a frame can be shown. Nothing waits for
    // the whole file, and because this is re-evaluated on every media event and on the existing poll,
    // the loader cannot get stuck after the media is ready. The lifecycle reducer ignores a repeat.
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      mediaReadyHandlerRef.current()
    }

    const mediaDuration = video.duration
    if (Number.isFinite(mediaDuration) && mediaDuration > 0 && lastDurationRef.current !== mediaDuration) {
      lastDurationRef.current = mediaDuration
      dispatch({ type: 'SET_DURATION', payload: mediaDuration })
    }

    const nextBufferedAmount = getLoadedWindowSeconds(video.buffered, Number.isFinite(video.currentTime) ? video.currentTime : 0)
    if (Number.isFinite(nextBufferedAmount)) {
      setBufferedAmount((previous) => (Math.abs(previous - nextBufferedAmount) < 0.25 ? previous : nextBufferedAmount))
    }

    if (video instanceof HTMLVideoElement && video.videoHeight > 0) {
      // Kept as the largest height seen for this source: a lower rendition must not shrink the list of
      // resolutions the source can still deliver.
      setSourceVideoHeight((previous) => (previous >= video.videoHeight ? previous : video.videoHeight))
    }

    // A quality change reloads the same element, so the position and play state are restored as soon
    // as the replacement rendition is selected. Until the browser swaps the source, the element still
    // reports the previous rendition's metadata and position, so the resume is only consumed once the
    // media is back at its start (or when there was no position worth preserving).
    const pendingResume = pendingResumeRef.current
    const mediaAtStart = !Number.isFinite(video.currentTime) || video.currentTime <= 0.05
    if (pendingResume && video.readyState >= HTMLMediaElement.HAVE_METADATA && (pendingResume.time <= 0.05 || mediaAtStart)) {
      pendingResumeRef.current = null
      const latestSeek = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.25) : pendingResume.time
      try {
        video.currentTime = Math.min(pendingResume.time, latestSeek)
      } catch {
        // A rejected seek leaves playback at the start of the new rendition.
      }
      if (pendingResume.wasPlaying) {
        void video.play().catch(() => undefined)
      }
    }
  }, [dispatch])

  const updateLiveWindow = useCallback(() => {
    const video = getVideoElement()
    if (!video) return

    const seekable = getLastTimeRange(video.seekable)
    const liveEdge = seekable && typeof seekable.end === 'number' ? seekable.end : 0
    const hasTimeshift = Boolean(seekable && liveEdge - seekable.start > 1)
    const isLive = Boolean(seekable && (!Number.isFinite(video.duration) || video.duration === Infinity))

    const previousMediaTime = lastMediaTimeRef.current
    if (!video.paused && Number.isFinite(video.currentTime) && previousMediaTime !== null && video.currentTime > previousMediaTime) {
      setHasNativeMediaReady(true)
    }
    lastMediaTimeRef.current = Number.isFinite(video.currentTime) ? video.currentTime : previousMediaTime

    setLiveWindow((previous) => {
      if (previous.hasTimeshift === hasTimeshift && previous.liveEdge === liveEdge && previous.currentTime === video.currentTime && previous.isLive === isLive) {
        return previous
      }

      return { hasTimeshift, liveStart: seekable?.start ?? 0, liveEdge, currentTime: video.currentTime, isLive }
    })
    dispatch({ type: 'SET_PLAYED', payload: Number.isFinite(video.currentTime) ? video.currentTime : 0 })
    syncMediaMetrics(video)
    updateTimelineDom()
  }, [dispatch, getLastTimeRange, getVideoElement, syncMediaMetrics, updateTimelineDom])

  // ---------------------------------------------------------------- HLS handle + media adapter

  /**
   * Reads the subtitle renditions of the current manifest.
   *
   * The identity of the list is kept stable while its content is unchanged, because the caption
   * selection is re-applied whenever the list changes.
   */
  const syncHlsSubtitleTracks = useCallback((handle?: HlsPlayer | null) => {
    const resolved = handle ?? getHlsHandle(videoElementRef.current) ?? getHlsHandle(playerRef.current)
    const next = mapHlsSubtitleTracks(resolved?.subtitleTracks)
    setHlsSubtitleTracks((previous) => (areSubtitleTrackListsEqual(previous, next) ? previous : next))
  }, [])

  /**
   * Applies the selected caption language to hls.js.
   *
   * The native TextTracks of a subtitle rendition only exist once hls.js has created them, so the handle
   * is the dependable place to switch captions on and off: `subtitleTrack` loads or releases the
   * rendition and `subtitleDisplay` decides whether its cues are rendered. A language that the manifest
   * does not offer simply leaves captions off.
   */
  const applyHlsSubtitleSelection = useCallback((language: string | null) => {
    const handle = hlsRef.current ?? getHlsHandle(videoElementRef.current) ?? getHlsHandle(playerRef.current)
    const tracks = handle?.subtitleTracks
    if (!handle || !Array.isArray(tracks)) return

    const normalized = (language || '').trim().toLowerCase()
    const trackIndex = normalized
      ? tracks.findIndex((track) => {
          const trackLanguage = typeof track.lang === 'string' ? track.lang.toLowerCase() : ''
          return trackLanguage === normalized
            || trackLanguage.startsWith(`${normalized}-`)
            || normalized.startsWith(`${trackLanguage}-`)
        })
      : -1

    try {
      if (trackIndex < 0) {
        Object.assign(handle, { subtitleDisplay: false, subtitleTrack: -1 })
        return
      }

      Object.assign(handle, { subtitleDisplay: true, subtitleTrack: trackIndex })
    } catch {
      // A destroyed instance rejects the selection; the next load re-applies it.
    }
  }, [])

  useEffect(() => {
    applyHlsSubtitleSelection(selectedSubtitleLanguage)
  }, [applyHlsSubtitleSelection, hlsSubtitleTracks, selectedSubtitleLanguage])

  /**
   * Re-reads the media's own text tracks whenever the *list* changes.
   *
   * A subtitle rendition produces its TextTrack only after hls.js appended its fragment, which happens
   * after the selection was made: without this the chosen language could never be applied to a track
   * that appeared later, and the same applies to any source that adds tracks as it loads.
   *
   * Only add/remove events are observed. Mode changes are deliberately not handled: hls.js derives its
   * subtitle selection from the native track modes, so re-applying modes on every change made the two
   * fight over the same tracks and could loop until React aborted the update.
   */
  useEffect(() => {
    const textTracks = mediaElement?.textTracks
    if (!textTracks) return

    const handleTextTracksChanged = () => {
      refreshNativeTracks(mediaElement)
      applySubtitleLanguage(selectedSubtitleLanguageRef.current)
    }
    textTracks.addEventListener('addtrack', handleTextTracksChanged)
    textTracks.addEventListener('removetrack', handleTextTracksChanged)
    return () => {
      textTracks.removeEventListener('addtrack', handleTextTracksChanged)
      textTracks.removeEventListener('removetrack', handleTextTracksChanged)
    }
  }, [applySubtitleLanguage, mediaElement, refreshNativeTracks])

  useEffect(() => {
    selectedSubtitleLanguageRef.current = selectedSubtitleLanguage
  }, [selectedSubtitleLanguage])

  /**
   * Attaches the lifecycle listeners to the hls.js instance behind the current media element.
   *
   * react-player v3 plays HLS through `hls-video-element`, which keeps its hls.js instance on
   * `element.api`: manifest, fragment, stall and error events are only observable from there. The
   * listeners are re-attached whenever the element reports a new load (the instance is recreated per
   * load and set to null when destroyed), and every handler verifies the handle, the source key and the
   * source generation before touching state.
   */
  const attachHlsListeners = useCallback((handle: HlsPlayer) => {
    if (hlsRef.current === handle && hlsCleanupRef.current) return

    hlsCleanupRef.current?.()
    hlsRef.current = handle

    const activeGeneration = sourceGenerationRef.current
    const isCurrentHandle = () => !terminatedRef.current
      && hlsRef.current === handle
      && sourceGenerationRef.current === activeGeneration
      && currentSourceKeyRef.current === sourceKey

    const syncQualityState = () => {
      const activeLevels = normalizeQualityLevels(handle.levels)
      setQualityLevels(activeLevels)
      const nextCurrentLevel = getActualHlsCurrentLevel(handle, activeLevels)
      setCurrentLevel(nextCurrentLevel)
      manualQualityRef.current = nextCurrentLevel >= 0 && !handle.autoLevelEnabled
    }
    syncQualityState()
    syncHlsSubtitleTracks(handle)

    const onManifestParsed = () => {
      if (!isCurrentHandle()) return
      noteProgress()
      syncQualityState()
      syncHlsSubtitleTracks(handle)
      trackTelemetry('manifest_ready')
    }
    const onSubtitleTracksUpdated = () => {
      if (!isCurrentHandle()) return
      syncHlsSubtitleTracks(handle)
    }
    const onSubtitleTrackSwitched = () => {
      if (!isCurrentHandle()) return
      // hls.js owns the authoritative selection, so the media's tracks are re-read: a rendition whose
      // TextTrack appears after the switch is picked up here and gets the selected mode applied.
      const video = videoElementRef.current
      if (video) refreshNativeTracks(video)
    }
    const onLevelLoaded = () => {
      if (!isCurrentHandle()) return
      noteProgress()
    }
    const onFragBuffered = () => {
      if (!isCurrentHandle()) return
      noteProgress()
    }
    const onBufferAppended = () => {
      if (!isCurrentHandle()) return
      noteProgress()
    }
    const onStallResolved = () => {
      if (!isCurrentHandle()) return
      dispatchLifecycle({ type: 'BUFFERING_END', sourceKey })
    }
    const onLevelSwitched = (_event: string, data: HlsEventData) => {
      if (!isCurrentHandle()) return
      const level = typeof data.level === 'number' ? data.level : -1
      trackTelemetry('bitrate_switch', { level })
      const nextCurrentLevel = getActualHlsCurrentLevel(handle, normalizeQualityLevels(handle.levels))
      const resolvedLevel = typeof handle.autoLevelEnabled === 'boolean'
        ? (handle.autoLevelEnabled ? -1 : level)
        : nextCurrentLevel
      setCurrentLevel(resolvedLevel)
      manualQualityRef.current = typeof handle.autoLevelEnabled === 'boolean' ? !handle.autoLevelEnabled : manualQualityRef.current
    }
    const onHlsError = (_event: string, data: HlsEventData) => {
      if (!isCurrentHandle()) return
      const failure = classifyHlsError(data)
      if (!failure) return

      if (!failure.fatal) {
        // A stall is a buffering condition on an otherwise healthy source, never a source failure.
        if (failure.detail === 'bufferStalledError' && hasStartedPlayback(lifecycleRef.current.status)) {
          dispatchLifecycle({ type: 'BUFFERING_START', sourceKey })
          trackTelemetry('buffering_start')
        }
        return
      }

      const telemetryEvent = failure.kind === 'timeout'
        ? 'playback_timeout'
        : failure.kind === 'network' ? 'network_error' : failure.kind === 'media' ? 'media_error' : 'fatal_error'
      failureHandlerRef.current(failure, telemetryEvent)
    }

    const listeners: Array<[string, (event: string, data: HlsEventData) => void]> = [
      ['hlsManifestParsed', onManifestParsed],
      ['hlsSubtitleTracksUpdated', onSubtitleTracksUpdated],
      ['hlsSubtitleTrackSwitch', onSubtitleTrackSwitched],
      ['hlsLevelLoaded', onLevelLoaded],
      ['hlsFragBuffered', onFragBuffered],
      ['hlsBufferAppended', onBufferAppended],
      ['hlsStallResolved', onStallResolved],
      ['hlsLevelSwitched', onLevelSwitched],
      ['hlsError', onHlsError],
    ]

    for (const [eventName, listener] of listeners) {
      try {
        handle.on(eventName, listener)
      } catch {
        // A destroyed instance rejects new listeners; the next load re-attaches them.
      }
    }

    hlsCleanupRef.current = () => {
      for (const [eventName, listener] of listeners) {
        try {
          handle.off?.(eventName, listener)
        } catch {
          // Ignore detach failures while the instance is being torn down.
        }
      }
    }
  }, [dispatchLifecycle, noteProgress, refreshNativeTracks, sourceKey, syncHlsSubtitleTracks, trackTelemetry])

  /** Resolves the hls.js instance of the current element and attaches the listeners when it appears. */
  const syncHlsHandle = useCallback(() => {
    const element = videoElementRef.current
    if (!element) return
    const handle = getHlsHandle(element)
    if (handle) attachHlsListeners(handle)
  }, [attachHlsListeners])

  /**
   * The one readiness transition: the current source has data it can render.
   *
   * It is idempotent (the reducer ignores a repeat) and deliberately does not re-enter the metric sync,
   * so it can be called from media events and from the metrics poll without recursion or churn.
   */
  const notifyMediaReady = useCallback(() => {
    if (!isCurrentSource()) return
    if (awaitingRenditionReloadRef.current) {
      const video = videoElementRef.current
      const mediaAtStart = !video || !Number.isFinite(video.currentTime) || video.currentTime <= 0.05
      if (!mediaAtStart) return
      awaitingRenditionReloadRef.current = false
    }
    dispatchLifecycle({ type: 'MEDIA_READY', sourceKey })
    setHasNativeMediaReady(true)
  }, [dispatchLifecycle, isCurrentSource, sourceKey])

  useEffect(() => {
    mediaReadyHandlerRef.current = notifyMediaReady
  }, [notifyMediaReady])

  const handleMediaLoadStart = useCallback(() => {
    if (!isCurrentSource()) return
    syncHlsHandle()
  }, [isCurrentSource, syncHlsHandle])

  const handleMediaLoadedMetadata = useCallback(() => {
    if (!isCurrentSource()) return
    noteProgress()
    syncHlsHandle()
    const video = videoElementRef.current
    if (!video) return
    // Native tracks of the new source only exist once its metadata is loaded.
    refreshNativeTracks(video)
    syncMediaMetrics(video)
  }, [isCurrentSource, noteProgress, refreshNativeTracks, syncHlsHandle, syncMediaMetrics])

  /** Readiness: `loadeddata`/`canplay` mean the element can render a frame of this source. */
  const handleMediaBecameReady = useCallback(() => {
    if (!isCurrentSource()) return
    notifyMediaReady()
    const video = videoElementRef.current
    if (video) syncMediaMetrics(video)
  }, [isCurrentSource, notifyMediaReady, syncMediaMetrics])

  const handleMediaProgress = useCallback(() => {
    if (!isCurrentSource()) return
    noteProgress()
    const video = videoElementRef.current
    if (video) syncMediaMetrics(video)
  }, [isCurrentSource, noteProgress, syncMediaMetrics])

  const handleMediaPlaying = useCallback(() => {
    if (!isCurrentSource()) return
    const wasTerminal = isTerminalPlaybackStatus(lifecycleRef.current.status)
    // Playback started, so the viewer's intent is to keep this stream running (this also covers the
    // automatic resume after a retry, which the element reports as an ordinary play).
    playIntentRef.current = true
    setHasNativeMediaReady(true)
    dispatchLifecycle({ type: 'PLAYING', sourceKey })
    dispatch({ type: 'SET_PLAYING', payload: true })
    syncHlsHandle()
    if (wasTerminal) clearPlayerError()
    joinViewerPresence()
    trackTelemetry('first_play')
  }, [clearPlayerError, dispatch, dispatchLifecycle, isCurrentSource, joinViewerPresence, sourceKey, syncHlsHandle, trackTelemetry])

  const handleMediaWaiting = useCallback(() => {
    if (!isCurrentSource()) return
    if (!hasStartedPlayback(lifecycleRef.current.status)) return
    dispatchLifecycle({ type: 'BUFFERING_START', sourceKey })
    trackTelemetry('buffering_start')
  }, [dispatchLifecycle, isCurrentSource, sourceKey, trackTelemetry])

  const handleMediaBufferingEnd = useCallback(() => {
    if (!isCurrentSource()) return
    if (lifecycleRef.current.status !== 'buffering') return
    dispatchLifecycle({ type: 'BUFFERING_END', sourceKey })
    trackTelemetry('buffering_end')
  }, [dispatchLifecycle, isCurrentSource, sourceKey, trackTelemetry])

  const handleMediaPaused = useCallback(() => {
    if (!isCurrentSource()) return
    dispatchLifecycle({ type: 'PAUSED', sourceKey })
    dispatch({ type: 'SET_PLAYING', payload: false })
  }, [dispatch, dispatchLifecycle, isCurrentSource, sourceKey])

  const handleMediaEnded = useCallback(() => {
    if (!isCurrentSource()) return
    playIntentRef.current = false
    leaveViewerPresence()
    trackTelemetry('ended')
    dispatch({ type: 'SET_PLAYING', payload: false })
  }, [dispatch, isCurrentSource, leaveViewerPresence, trackTelemetry])

  const handleMediaError = useCallback(() => {
    if (!isCurrentSource()) return
    const failure = classifyMediaError(videoElementRef.current?.error)
    if (!failure) return
    const telemetryEvent = failure.kind === 'network' ? 'network_error' : failure.kind === 'media' || failure.kind === 'decoder' ? 'media_error' : 'fatal_error'
    failureHandlerRef.current(failure, telemetryEvent)
  }, [isCurrentSource])

  useVideoLifecycle({
    video: mediaElement,
    sourceKey,
    isCurrent: isCurrentSource,
    onLoadStart: handleMediaLoadStart,
    onLoadedMetadata: handleMediaLoadedMetadata,
    onReady: handleMediaBecameReady,
    onProgress: handleMediaProgress,
    onPlaying: handleMediaPlaying,
    onWaiting: handleMediaWaiting,
    onStalled: handleMediaWaiting,
    onSeeking: handleMediaWaiting,
    onSeeked: handleMediaBufferingEnd,
    onPause: handleMediaPaused,
    onEnded: handleMediaEnded,
    onError: handleMediaError,
  })

  const syncNativeVolume = useCallback((nextVolume: number) => { // Changed to use useCallback
    const video = getVideoElement()
    const safeVolume = Math.min(1, Math.max(0, nextVolume))

    if (video) {
      video.volume = safeVolume
      video.muted = safeVolume === 0
    }

    if (safeVolume > 0) {
      prevVolumeRef.current = safeVolume
    }

    dispatch({ type: 'SET_VOLUME', payload: safeVolume })
  }, [getVideoElement])

  const getCurrentMediaVolume = useCallback(() => { // Changed to use useCallback
    const video = getVideoElement()
    if (video) {
      const mediaVolume = Number.isFinite(video.volume) ? video.volume : 0
      return Math.min(1, Math.max(0, mediaVolume))
    }

    return Math.min(1, Math.max(0, volume))
  }, [getVideoElement, volume])

  const volumeContainerRef = useRef<HTMLDivElement | null>(null)

  const detachVolumeDragListeners = useCallback(() => { // Changed to use useCallback
    if (!volumePointerCleanupRef.current) return
    volumePointerCleanupRef.current()
    volumePointerCleanupRef.current = null
  }, [])

  const handleVolumeSliderKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => { // Changed to use useCallback
    event.stopPropagation();
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) event.preventDefault();
    if (event.key === 'ArrowRight') syncNativeVolume(Math.min(1, volume + 0.05));
    if (event.key === 'ArrowLeft') syncNativeVolume(Math.max(0, volume - 0.05));
    if (event.key === 'Home') syncNativeVolume(1);
    if (event.key === 'End') syncNativeVolume(0);
  }, [syncNativeVolume, volume]);
  
  const tapTimeoutRef = useRef<number | null>(null)
  const lastTouchRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const orientationLockedRef = useRef(false)
  const brandLabel = 'SportZoneBD'

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  
    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const updateTouchState = () => setIsTouchDevice(mediaQuery.matches)

    updateTouchState()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateTouchState)
      return () => mediaQuery.removeEventListener('change', updateTouchState)
    }

    mediaQuery.addListener(updateTouchState)
    return () => mediaQuery.removeListener(updateTouchState)
  }, [])

  const resolvedUrl = typeof currentUrl === 'string' ? currentUrl.trim() : ''
  const isHlsSource = useMemo(() => {
    if (!resolvedUrl) return false
    if (/\.m3u8(\?|$)/i.test(resolvedUrl)) return true
    return /\/stream\/proxy(\?|$)/i.test(resolvedUrl)
  }, [resolvedUrl])
  const showSeekControls = Boolean(resolvedUrl) && !isHlsSource

  // Progressive highlights offer only the Cloudinary renditions their source can really deliver;
  // HLS keeps using the levels hls.js reports.
  const vodQualityLevels = useMemo(() => {
    if (isHlsSource || !isCloudinaryVideoUrl(resolvedUrl)) return []
    return buildVodQualityLevels(sourceVideoHeight)
  }, [isHlsSource, resolvedUrl, sourceVideoHeight])
  const activeQualityLevels = qualityLevels.length > 0 ? qualityLevels : vodQualityLevels
  const playbackUrl = !isHlsSource && manualVideoHeight && isCloudinaryVideoUrl(resolvedUrl)
    ? buildCloudinaryUrl(resolvedUrl, { resourceType: 'video', height: manualVideoHeight, crop: 'limit' })
    : resolvedUrl

  const handlePlayPause = useCallback(() => {
    const video = getVideoElement()
    if (!video) {
      dispatch({ type: 'TOGGLE_PLAY' })
      return
    }

    if (video.paused || video.ended) {
      playIntentRef.current = true
      void video.play().catch(() => dispatch({ type: 'SET_PLAYING', payload: false }))
    } else {
      // Only a viewer pausing clears the intent; the player's own teardown pauses must not.
      playIntentRef.current = false
      video.pause()
    }
  }, [getVideoElement])

  // Publishes play/pause for hosts that own the keyboard (TV Mode) instead of the player's shortcuts.
  useEffect(() => {
    if (!onTransportReady) return

    onTransportReady({ playPause: handlePlayPause, isPlaying })
    return () => {
      onTransportReady(null)
    }
  }, [handlePlayPause, isPlaying, onTransportReady])

  const handleToggleMute = useCallback(() => {
    const video = getVideoElement()
    const currentVolume = getCurrentMediaVolume()

    if (video && (video.muted || currentVolume === 0)) {
      const targetVolume = prevVolumeRef.current > 0
        ? prevVolumeRef.current
        : currentVolume > 0
          ? currentVolume
          : volume > 0
            ? volume
            : 0.8

      video.muted = false
      video.volume = targetVolume
      syncNativeVolume(targetVolume)
      return
    }

    if (currentVolume > 0) {
      prevVolumeRef.current = currentVolume
    }

    if (video) {
      video.volume = 0
      video.muted = true
    }

    syncNativeVolume(0)
  }, [getCurrentMediaVolume, getVideoElement, syncNativeVolume, volume])
  
  const handleVolumeButtonClick = useCallback((event: React.MouseEvent<HTMLElement>) => { // Changed to use useCallback
    event.stopPropagation()
    const currentVolume = getCurrentMediaVolume()
    if (currentVolume > 0) {
      prevVolumeRef.current = currentVolume
      syncNativeVolume(0)
    } else {
      const newVolume = prevVolumeRef.current > 0.05 ? prevVolumeRef.current : 0.5
      syncNativeVolume(newVolume)
    }
  }, [getCurrentMediaVolume, syncNativeVolume])

  const handleVolumeInputChange = useCallback((nextVolume: number) => {
    syncNativeVolume(nextVolume)
  }, [syncNativeVolume])
  
  const handleControlsSurfaceClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (isSettingsOpen) return

    const target = event.target as HTMLElement | null
    if (target?.closest('button, input, [role="button"], [role="slider"], [role="menu"]')) return

    // A locked player has no control bar, so any tap only brings the unlock affordance back.
    if (isLocked) {
      showControls()
      return
    }

    // Touch surfaces own this gesture: a tap reveals or hides the chrome. The skip shortcuts are not a
    // reason to swallow it — video highlights would otherwise never let the controls be hidden again.
    if (isTouchDevice) {
      if (!controlsVisible) {
        showControls()
        return
      }

      toggleControls()
      return
    }

    if (showSeekControls) {
      showControls()
      return
    }

    if (tapTimeoutRef.current !== null) window.clearTimeout(tapTimeoutRef.current)
    writeRef(tapTimeoutRef, window.setTimeout(() => {
      handlePlayPause()
      if (!controlsVisible) showControls()
      else toggleControls()
      writeRef(tapTimeoutRef, null)
    }, 180))
  }, [controlsVisible, handlePlayPause, isLocked, isSettingsOpen, isTouchDevice, showControls, showSeekControls, toggleControls])

  const handleVolumeUp = useCallback(() => { // Changed to use useCallback
    syncNativeVolume(Math.min(volume + 0.05, 1))
  }, [syncNativeVolume, volume])
  
  const handleVolumeDown = useCallback(() => { // Changed to use useCallback
    const newVolume = Math.max(volume - 0.05, 0)
    syncNativeVolume(newVolume)
  }, [syncNativeVolume, volume])
  
  const handleIncreaseSpeed = useCallback(() => { // Changed to use useCallback
    const currentIndex = playbackRates.indexOf(playbackRate);
    const nextIndex = Math.min(currentIndex + 1, playbackRates.length - 1);
    if (playbackRates[nextIndex] !== playbackRate) {
      dispatch({ type: 'SET_PLAYBACK_RATE', payload: playbackRates[nextIndex] });
    }
  }, [playbackRate, playbackRates]);
  
  const handleDecreaseSpeed = useCallback(() => { // Changed to use useCallback
    const currentIndex = playbackRates.indexOf(playbackRate);
    const nextIndex = Math.max(currentIndex - 1, 0);
    dispatch({ type: 'SET_PLAYBACK_RATE', payload: playbackRates[nextIndex] });
  }, [playbackRate, playbackRates]);
  
  const handleToggleSubtitles = useCallback(() => { // Changed to use useCallback
    if (!subtitleChoices.length) return

    const current = selectedSubtitleLanguage
    if (current) {
      selectSubtitleLanguage(null)
      return
    }

    selectSubtitleLanguage(preferredLanguage)
  }, [preferredLanguage, selectSubtitleLanguage, selectedSubtitleLanguage, subtitleChoices.length])
  
  const handleSetSubtitleLanguage = useCallback((language: string | null) => { // Changed to use useCallback
    if (!subtitleChoices.length) return
    selectSubtitleLanguage(language)
    dispatch({ type: 'TOGGLE_SETTINGS' })
    settingsButtonRef.current?.focus()
  }, [dispatch, selectSubtitleLanguage, subtitleChoices.length])
  
  const handleToggleFullscreen = useCallback(async () => {
    await toggleFullscreen()
  }, [toggleFullscreen])

  const handleControlsSurfaceDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (tapTimeoutRef.current !== null) {
      window.clearTimeout(tapTimeoutRef.current)
      writeRef(tapTimeoutRef, null)
    }
    if (!isLocked && !compactControls) void handleToggleFullscreen()
  }, [compactControls, handleToggleFullscreen, isLocked])

  const handleContainerDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => { // Changed to use useCallback
    event.stopPropagation()
    if (tapTimeoutRef.current !== null) {
      window.clearTimeout(tapTimeoutRef.current)
      writeRef(tapTimeoutRef, null)
    }
    if (isLocked || compactControls || isTouchDevice) return
    handleToggleFullscreen()
  }, [compactControls, handleToggleFullscreen, isLocked, isTouchDevice])

  useEffect(() => {
    const tapTimeout = tapTimeoutRef
    return () => {
      if (tapTimeout.current !== null) {
        window.clearTimeout(tapTimeout.current)
        writeRef(tapTimeout, null)
      }
    }
  }, [compactControls, isTouchDevice, sourceKey])

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (compactControls || event.changedTouches.length !== 1) return

    const target = event.target as HTMLElement | null
    if (target?.closest('button, input, [role="button"], [role="slider"], [role="menu"]')) {
      writeRef(lastTouchRef, null)
      return
    }

    // While locked there are no controls to toggle, so the tap only reveals the unlock affordance.
    if (isLocked) {
      writeRef(lastTouchRef, null)
      showControls()
      return
    }

    const touch = event.changedTouches[0]
    const now = Date.now()
    const previous = lastTouchRef.current
    const isDoubleTap = Boolean(previous && now - previous.time < 320 && Math.hypot(touch.clientX - previous.x, touch.clientY - previous.y) < 40)
    writeRef(lastTouchRef, { time: now, x: touch.clientX, y: touch.clientY })

    if (isDoubleTap) {
      event.preventDefault()
      writeRef(lastTouchRef, null)
      if (tapTimeoutRef.current !== null) {
        window.clearTimeout(tapTimeoutRef.current)
        writeRef(tapTimeoutRef, null)
      }
      void handleToggleFullscreen()
      return
    }
  }, [compactControls, handleToggleFullscreen, isLocked, showControls])
  
  const handleLockScreen = useCallback((event?: React.MouseEvent<HTMLElement>) => { // Changed to use useCallback
    event?.stopPropagation()
    setIsLocked(true)
    setActiveSettingsSection('root')
    dispatch({ type: 'SET_CONTROLS_VISIBLE', payload: false })
    if (isSettingsOpen) {
      dispatch({ type: 'TOGGLE_SETTINGS' })
    }
  }, [isSettingsOpen])
  
  const handleUnlockScreen = useCallback((event: React.MouseEvent<HTMLElement>) => { // Changed to use useCallback
    event.stopPropagation()
    setIsLocked(false)
    dispatch({ type: 'SET_CONTROLS_VISIBLE', payload: true })
  }, [])
  
  const handleTogglePictureInPicture = useCallback(async () => {
    await togglePictureInPicture()
  }, [togglePictureInPicture])

  const handleSeekMouseDown = useCallback((event?: React.MouseEvent<HTMLInputElement>) => { // Changed to use useCallback
    event?.stopPropagation()
    dispatch({ type: 'SET_SEEKING', payload: true })
  }, [])
  
  const handleSeekChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => { // Changed to use useCallback
    event?.stopPropagation()
    const video = getVideoElement()
    const seekable = video ? getLastTimeRange(video.seekable) : null
    const ratio = Number.parseFloat(event.currentTarget.value)
    if (!video || !Number.isFinite(ratio)) return

    if (seekable) {
      video.currentTime = seekable.start + ratio * (seekable.end - seekable.start)
    } else if (Number.isFinite(video.duration)) {
      video.currentTime = ratio * video.duration
    }
    updateLiveWindow()
    updateTimelineDom()
  }, [getLastTimeRange, getVideoElement, updateLiveWindow, updateTimelineDom])
  
  const handleSeekMouseUp = useCallback((event?: React.MouseEvent<HTMLInputElement>) => { // Changed to use useCallback
    event?.stopPropagation()
    dispatch({ type: 'SET_SEEKING', payload: false })
    updateLiveWindow()
  }, [updateLiveWindow])

  const seekBy = useCallback((seconds: number) => {
    const video = getVideoElement()
    if (!video || !Number.isFinite(video.currentTime)) return
    const seekable = getLastTimeRange(video.seekable)
    const minimum = seekable?.start ?? 0
    const maximum = seekable?.end ?? (Number.isFinite(video.duration) ? video.duration : video.currentTime)
    video.currentTime = Math.min(maximum, Math.max(minimum, video.currentTime + seconds))
    updateLiveWindow()
    updateTimelineDom()
  }, [getLastTimeRange, getVideoElement, updateLiveWindow, updateTimelineDom])

  const handleSeekBackward = useCallback(() => {
    seekBy(-5)
  }, [seekBy])

  const handleSeekForward = useCallback(() => {
    seekBy(10)
  }, [seekBy])

  /**
   * Manual recovery: the viewer asked for the current stream again.
   *
   * The retry chain is reset first, so the attempt starts from the source's own preferred transport
   * (proxy primary), and the media element is recreated — which is also what releases a wedged MSE
   * buffer or a decoder that gave up.
   *
   * The teardown pauses the element, so the position and the viewer's play intent are captured before it
   * runs and restored once the replacement has data: a retry must not quietly leave the stream paused at
   * the start. A live source has no position worth preserving, so only the intent is restored there.
   */
  const handleRetry = useCallback(() => {
    // A retry that is already running owns the recovery; a second press must not stack attempts.
    if (lifecycleRef.current.status === 'retrying') return

    const video = videoElementRef.current
    const resumeTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0
    const isLiveSource = liveWindow.isLive || (video ? !Number.isFinite(video.duration) : false)
    const resumeIntent = playIntentRef.current
    writeRef(pendingResumeRef, resumeIntent && !isLiveSource && resumeTime > 0.05
      ? { time: resumeTime, wasPlaying: true }
      : null)

    resetFallbackState()
    fallbackRequestedUrlRef.current = null
    awaitingRenditionReloadRef.current = false
    suppressAutoplayOnSourceChangeRef.current = false
    stopPlayback()
    terminatedRef.current = false
    currentSourceKeyRef.current = sourceKey
    clearQualityToast()
    clearPlayerError()
    dispatch({ type: 'SET_PLAYING', payload: resumeIntent })
    dispatchLifecycle({ type: 'RETRY', sourceKey })
    trackTelemetry('playback_retry')
    refreshPlayer()
  }, [clearPlayerError, clearQualityToast, dispatch, dispatchLifecycle, liveWindow.isLive, refreshPlayer, resetFallbackState, sourceKey, stopPlayback, trackTelemetry])

  useEffect(() => {
    if (!resolvedUrl) return

    trackTelemetry('load_start')
  }, [resolvedUrl, sourceKey, trackTelemetry])

  const syncDuration = useCallback(() => { // Changed to use useCallback
    const nextDuration = resolveMediaElement(playerRef.current)?.duration
    if (typeof nextDuration === 'number' && !Number.isNaN(nextDuration)) {
      dispatch({ type: 'SET_DURATION', payload: nextDuration });
    }
  }, [])
  
  const handleReady = useCallback(() => { // Changed to use useCallback
    if (terminatedRef.current || currentSourceKeyRef.current !== sourceKey) return

    setHasNativeMediaReady(true)

    const internalPlayer = resolveMediaElement(playerRef.current)
    if (internalPlayer instanceof HTMLMediaElement) {
      const media = internalPlayer
      videoElementRef.current = media
      const nativeVolume = Number.isFinite(media.volume) ? media.volume : volume
      if (nativeVolume > 0) {
        prevVolumeRef.current = nativeVolume
      }
      media.volume = volume
      media.muted = isMuted
      media.playbackRate = playbackRate
      media.style.objectFit = 'contain'
      // react-player v3 does not forward a poster prop to the media element, so it is applied directly.
      if (poster && 'poster' in media) (media as HTMLVideoElement).poster = poster

      // The media element becomes explicit state so `useVideoLifecycle` owns exactly one set of
      // listeners for it; source and rendition changes therefore cannot leave stale listeners behind.
      startTransition(() => setMediaElement(media))
      syncHlsHandle()
      syncMediaMetrics(media)

      const nextSubtitleTracks = Array.from(media.textTracks || []).map((track, index) => ({
        kind: (track.kind === 'captions' ? 'captions' : 'subtitles') as SubtitleTrack['kind'],
        src: track.label || `track-${index}`,
        srcLang: track.language || track.label || `lang-${index + 1}`,
        label: track.label || track.language || `Subtitle ${index + 1}`,
        default: track.mode === 'showing',
      }))

      const mergedTracks = [...(subtitles || []), ...nextSubtitleTracks]
      const uniqueTracks = mergedTracks.filter((track, index, arr) => {
        const key = `${track.srcLang}-${track.label}-${track.kind}`
        return arr.findIndex((item) => `${item.srcLang}-${item.label}-${item.kind}` === key) === index
      })

      if (uniqueTracks.length > 0) {
        const defaultSubtitle = uniqueTracks.find((track) => track.default)
        const currentSelected = selectedSubtitleLanguage || defaultSubtitle?.srcLang || null
        refreshNativeTracks(media)
        if (currentSelected) {
          applySubtitleLanguage(currentSelected)
        } else {
          applySubtitleLanguage(null)
        }
      } else {
        refreshNativeTracks(media)
      }
    }

    updateLiveWindow()

    syncDuration()
    syncHlsHandle()
  }, [applySubtitleLanguage, isMuted, playbackRate, poster, refreshNativeTracks, selectedSubtitleLanguage, sourceKey, subtitles, syncDuration, syncHlsHandle, syncMediaMetrics, updateLiveWindow, volume])

  /**
   * Runs the media setup as soon as the ref publishes an element.
   *
   * HLS sources never report react-player's `onReady`, so this is what applies the poster, the fit and
   * the readiness flag for them. It runs once per element and both triggers are idempotent, so a
   * progressive source that reports both is unaffected.
   */
  const mediaSetupElementRef = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    if (!mediaElement || mediaSetupElementRef.current === mediaElement) return
    mediaSetupElementRef.current = mediaElement
    handleReady()
  }, [handleReady, mediaElement])
  
  useEffect(() => { // Changed to use useEffect
    const tapTimeout = tapTimeoutRef
    return () => {
      detachVolumeDragListeners()
      if (tapTimeout.current !== null) {
        window.clearTimeout(tapTimeout.current)
        writeRef(tapTimeout, null)
      }
    }
  }, [detachVolumeDragListeners])

  // The playback teardown belongs to unmount alone. Keying it on a callback identity stopped a player
  // that was still on screen and left it permanently terminated: `stopPlayback()` clears the source key
  // and marks the element as released, and only a source change would have lifted that again.
  useEffect(() => () => stopPlaybackRef.current(), [])
  
  const initializedSourceKeyRef = useRef<string | null>(null)
  useEffect(() => { // Changed to use useEffect
    // Everything below belongs to the source that is being replaced. A re-render of this component (a
    // socket update, a presence or advertisement state change anywhere above it) must not run the reset
    // again: it released the media element and restarted the lifecycle, which left the viewer watching an
    // endless "Loading stream…" while the channel was already playing.
    if (initializedSourceKeyRef.current === sourceKey) {
      // Effects are remounted in development (StrictMode, Fast Refresh) and the unmount teardown above
      // released the player, so the same source is re-armed instead of staying dead.
      if (terminatedRef.current) {
        terminatedRef.current = false
        currentSourceKeyRef.current = sourceKey
        refreshPlayer()
      }
      return
    }
    initializedSourceKeyRef.current = sourceKey

    if (previousSourceKeyRef.current !== sourceKey) {
      stopPlayback()
      terminatedRef.current = false
      currentSourceKeyRef.current = sourceKey
      previousSourceKeyRef.current = sourceKey
      refreshPlayer()
    }

    if (qualityToastTimeoutRef.current !== null) window.clearTimeout(qualityToastTimeoutRef.current)
    writeRef(qualityToastTimeoutRef, null)
    startTransition(() => setQualityToast(null))
    startTransition(() => setHasNativeMediaReady(false))
    startTransition(() => setMediaElement(null))
    fallbackRequestedUrlRef.current = null
    awaitingRenditionReloadRef.current = false
    const shouldAutoPlay = autoPlay && !suppressAutoplayOnSourceChangeRef.current
    suppressAutoplayOnSourceChangeRef.current = false
    // A candidate that replaces a failed source continues what the viewer was watching.
    const recoveryIntent = recoveryIntentRef.current
    recoveryIntentRef.current = false
    const shouldContinuePlayback = shouldAutoPlay || recoveryIntent
    // The new source starts with the intent its own rules dictate.
    playIntentRef.current = shouldContinuePlayback
    dispatch({ type: 'RESET_FOR_NEW_URL', payload: shouldContinuePlayback })
    // A new source starts a new lifecycle: loading, no error, no attempts, watchdog armed. The reducer
    // drops every late event that still belongs to the previous source key.
    dispatchLifecycle({ type: 'SOURCE_START', sourceKey })
    startTransition(() => {
      setQualityLevels([])
      setCurrentLevel(-1)
      // Caption renditions belong to the previous manifest and must not remain selectable for the next
      // source; the manifest of the new one republishes its own list.
      setHlsSubtitleTracks([])
      setLiveWindow({ hasTimeshift: false, liveStart: 0, liveEdge: 0, currentTime: 0, isLive: false })
      // Media metrics belong to the previous source and must not leak into the next one.
      setSourceVideoHeight(0)
      setBufferedAmount(0)
      setManualVideoHeight(null)
    })
    writeRef(pendingResumeRef, null)
    lastDurationRef.current = 0
    manualQualityRef.current = false
  }, [autoPlay, clearQualityToast, dispatchLifecycle, refreshPlayer, resolvedUrl, sourceKey, stopPlayback])

  const handleSetQuality = (levelIndex: number) => { // Changed to use handleSetQuality
    const hlsHandle = getHlsHandle(videoElementRef.current) ?? getHlsHandle(playerRef.current)

    if (hlsHandle) {
      try {
        const selectedLevel = qualityLevels.find((level) => level.hlsIndex === levelIndex)
        const nextIndex = levelIndex < 0 ? -1 : (selectedLevel && typeof selectedLevel.hlsIndex === 'number' ? selectedLevel.hlsIndex : -1)

        manualQualityRef.current = levelIndex >= 0 && Boolean(selectedLevel)

        // `autoLevelEnabled` is only a derivation of hls.js's `manualLevel`, and assigning it directly
        // throws (the property has no setter) — which aborted the whole change inside the surrounding
        // try/catch, so the selected channel quality never reached hls.js. Selecting is done through the
        // level setters instead; they update `manualLevel`, and auto is restored with -1.
        //
        // While playing, the switch waits for the next fragment boundary (`nextLevel`) because it does
        // not interrupt playback; assigning `currentLevel` flushes the buffer on the spot, which stalls
        // the stream. A paused element has no boundary to wait for, so it takes the immediate path.
        const video = getVideoElement()
        if (video && !video.paused) {
          Object.assign(hlsHandle, { nextLevel: nextIndex })
        } else {
          Object.assign(hlsHandle, { currentLevel: nextIndex })
        }
        setCurrentLevel(levelIndex < 0 ? -1 : nextIndex)
        const selectedLabel = levelIndex < 0 ? 'Auto' : selectedLevel ? `${selectedLevel.height}p` : null
        if (selectedLabel) showQualityToast(`Quality set to ${selectedLabel}`)
      } catch {
        // Ignore invalid HLS level selection
      }
    } else if (vodQualityLevels.length > 0) {
      const selectedLevel = levelIndex < 0 ? null : vodQualityLevels.find((level) => level.hlsIndex === levelIndex) ?? null
      const video = getVideoElement()

      // The same media element is reloaded with the new rendition, so the position and play state
      // are captured here and restored as soon as the replacement has metadata.
      if (video && Number.isFinite(video.currentTime)) {
        writeRef(pendingResumeRef, { time: video.currentTime, wasPlaying: !video.paused })
      }
      // The replacement rendition is a genuine media transition inside the same source, so it shows the
      // loading state until its own first frame is available — and it is bounded by the same watchdog.
      awaitingRenditionReloadRef.current = true
      dispatchLifecycle({ type: 'RENDITION_START', sourceKey })
      setManualVideoHeight(selectedLevel ? selectedLevel.height : null)
      setCurrentLevel(selectedLevel ? selectedLevel.hlsIndex : -1)
      showQualityToast(selectedLevel ? `Quality set to ${selectedLevel.height}p` : 'Quality set to Auto')
    }

    if (qualityLevels.length === 0 && levelIndex < 0) {
      setCurrentLevel(-1)
    }

    setActiveSettingsSection('root')
    dispatch({ type: 'TOGGLE_SETTINGS' })
    settingsButtonRef.current?.focus();
  };
  
  const handleSetPlaybackRate = (rate: number) => { // Changed to use handleSetPlaybackRate
    const video = getVideoElement()
    if (video) video.playbackRate = rate
    dispatch({ type: 'SET_PLAYBACK_RATE', payload: rate });
    setActiveSettingsSection('root')
    dispatch({ type: 'TOGGLE_SETTINGS' });
    settingsButtonRef.current?.focus();
  };
  
  useEffect(() => {
    if (!isFullscreenFromHook && orientationLockedRef.current) {
      screen.orientation?.unlock?.()
      orientationLockedRef.current = false
    }

    if (isFullscreenFromHook) {
      dispatch({ type: 'SET_CONTROLS_VISIBLE', payload: true })
    }
  }, [dispatch, isFullscreenFromHook])
  
  // Close settings menu when clicking outside // Changed to use useEffect
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isSettingsOpen &&
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(event.target as Node) &&
        !settingsButtonRef.current?.contains(event.target as Node)
      ) {
        dispatch({ type: 'TOGGLE_SETTINGS' });
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isSettingsOpen]);
  
  // Effect for handling keyboard shortcuts // Changed to use useEffect
  useEffect(() => { // Changed to use useEffect
    // TV Mode turns these off: there the arrows belong to D-pad navigation, not to seek/volume.
    if (!globalShortcuts) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLocked) return

      // Don't trigger shortcuts if the user is focused on an input element
      if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        return
      }
      if ((document.activeElement as HTMLElement | null)?.isContentEditable) return

      // Prevent default for space and arrow keys to avoid scrolling
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || (e.shiftKey && ['Comma', 'Period'].includes(e.code))) {
        e.preventDefault()
      }

      switch (e.code) {
        case 'Space':
          handlePlayPause()
          break
        case 'KeyF':
          handleToggleFullscreen()
          break
        case 'KeyM':
          handleToggleMute()
          break
        case 'KeyP':
          void handleTogglePictureInPicture()
          break
        case 'Escape':
          if (document.fullscreenElement) void document.exitFullscreen?.()
          break
        case 'ArrowUp':
          handleVolumeUp()
          break
        case 'ArrowDown':
          handleVolumeDown()
          break
        case 'ArrowLeft':
          seekBy(-10)
          break
        case 'ArrowRight':
          seekBy(10)
          break
        case 'Period':
          if (e.shiftKey) handleIncreaseSpeed()
          break
        case 'Comma':
          if (e.shiftKey) handleDecreaseSpeed()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [globalShortcuts, handleIncreaseSpeed, handleDecreaseSpeed, handlePlayPause, handleToggleFullscreen, handleToggleMute, handleTogglePictureInPicture, handleVolumeDown, handleVolumeUp, isLocked, seekBy])
  

  useEffect(() => { // Changed to use useEffect
    if (!resolvedUrl) return

    const video = getVideoElement()
    if (!video) return

    let frameId: number | null = null
    const refreshTimeline = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        updateTimelineDom()
      })
    }
    const refreshLiveWindow = () => {
      updateLiveWindow()
      refreshTimeline()
    }

    const events = ['timeupdate', 'progress', 'durationchange', 'loadedmetadata', 'loadeddata', 'canplay', 'seeking', 'seeked']
    events.forEach((eventName) => video.addEventListener(eventName, refreshLiveWindow))
    const liveWindowRefreshMs = shouldReduceEffects || isSmartTV ? 2000 : 1000
    const liveWindowTimer = window.setInterval(refreshLiveWindow, liveWindowRefreshMs)
    refreshLiveWindow()

    return () => {
      events.forEach((eventName) => video.removeEventListener(eventName, refreshLiveWindow))
      window.clearInterval(liveWindowTimer)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [getVideoElement, isSmartTV, resolvedUrl, shouldReduceEffects, updateLiveWindow, updateTimelineDom, url])

  useEffect(() => { // Changed to use useEffect
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      if (!(reason instanceof DOMException)) {
        return
      }

      const reasonName = typeof reason.name === 'string' ? reason.name.toLowerCase() : ''
      const reasonMessage = typeof reason.message === 'string' ? reason.message : ''
      const isAbort = reasonName === 'aborterror' && /fetching process for the media resource was aborted/i.test(reasonMessage)
      const isNotSupported = reasonName === 'notsupportederror'
        || /media resource indicated by the src attribute or assigned media provider object was not suitable/i.test(reasonMessage)
        || /failed to init decoder/i.test(reasonMessage)
        || /codec|decoder|media source/i.test(reasonMessage)

      if (isAbort || isNotSupported) {
        event.preventDefault()
      }
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection) // onPlayerError is a dependency
  }, [])
  
  const hlsOptions = useMemo<Record<string, unknown>>(() => { // Changed to use useMemo
    const baseOptions: Record<string, unknown> = {
      startPosition: -1,
      xhrSetup: (xhr: XMLHttpRequest) => {
        xhr.withCredentials = false
      },
    }

    if (isLowPower || networkQuality === 'slow' || reducedMotion) {
      return {
        ...baseOptions,
        maxBufferLength: 18,
        maxBufferSize: 18 * 1000 * 1000,
        backBufferLength: 10,
        liveSyncDurationCount: 2,
        maxMaxBufferLength: 24,
      }
    }

    return {
      ...baseOptions,
      maxBufferLength: 30,
      maxBufferSize: 30 * 1000 * 1000,
      backBufferLength: 30,
      liveSyncDurationCount: 3,
      maxMaxBufferLength: 45,
    }
  }, [isLowPower, networkQuality, reducedMotion])
  
  const playerConfig = useMemo<ReactPlayerProps['config']>(() => ({
    // react-player v3 keys the config by player (`config.hls`), and `hls-video-element` spreads it into
    // its hls.js instance. The old `file`/`forceHLS`/`hlsOptions` shape belonged to v2 and was ignored,
    // so the tuned buffer sizes never reached hls.js.
    ...(isHlsSource ? { hls: hlsOptions } : {}),
  }) as ReactPlayerProps['config'], [hlsOptions, isHlsSource])

  if (!resolvedUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <div className="text-center text-(--text-muted)">
          <Tv size={48} className="mx-auto mb-4" />
          <p>Stream unavailable</p>
        </div>
      </div>
    )
  }

  // One status for the whole surface, derived from the lifecycle: an initial load or a retry shows the
  // loading variant (with the recovery wording), a stall after playback started shows the buffering
  // variant, and a terminal error shows nothing at all so the error UI can never be covered by a loader.
  const loaderVariant = playbackLoaderVariant(lifecycle)
  const loaderLabel = playbackLoaderLabel(lifecycle)
  const showAlternateStreamAction = Boolean(onStreamFallback) && lifecycle.status === 'exhausted'
  // A live channel that ends up in a terminal state is "no signal"; a failed highlight is not, so the
  // static stays out of the file-based player.
  const showNoSignal = isTerminalPlaybackStatus(lifecycle.status) && Boolean(playerError) && (isHlsSource || presenceType === 'channel')

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={playerContainerRef}
        aria-busy={Boolean(loaderVariant)}
        aria-label={title ? `${title} video player` : 'Video player'}
        className={getPlayerContainerClass({ compact: compactControls, fullscreen: isFullscreen })}
        onDoubleClick={handleContainerDoubleClick}
        onMouseEnter={handlePlayerPointerEnter}
        onMouseMove={handlePlayerPointerMove}
        onMouseLeave={handlePlayerPointerLeave}
        onTouchEnd={handleTouchEnd}
      >
      <div className="pointer-events-none absolute right-4 bottom-[30%] z-20 text-right sm:right-6 lg:right-8">
        <span className="inline-flex items-center gap-1.5 text-[9px] font-black tracking-[0.18em] text-white/60 drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] sm:text-[10px] lg:text-[11px]">
          <span className="text-[#0474C4]">{brandLabel}</span>
        </span>
      </div>

      <React.Suspense fallback={<div className="absolute inset-0 z-20 bg-black/35" aria-hidden="true" />}>
          <LazyReactPlayer
            key={refreshKey}
            ref={handlePlayerRef}
            src={playbackUrl}
            playing={isPlaying && !!resolvedUrl}
            config={playerConfig}
            volume={isLowPower ? Math.min(volume, 0.7) : volume}
            muted={isMuted}
            playbackRate={isLowPower ? 1 : playbackRate}
            width="100%"
            height="100%"
            controls={false}
            onReady={() => {
              if (refreshKey !== refreshKeyRef.current) return
              handleReady()
            }}
            onProgress={() => {
              updateTimelineDom()
              // Any forward progress means playback resumed, so the buffering indicator cannot stick.
              if (lifecycleRef.current.status === 'buffering') handleMediaBufferingEnd()
            }}
            onEnded={() => {
              handleMediaEnded()
            }}
            playsInline={true}
            onError={(e: unknown) => {
              if (refreshKey !== refreshKeyRef.current) return
              if (!isCurrentSource()) return

              const playerErrorEvent = e as { nativeEvent?: unknown; target?: { error?: MediaError | null } | null }
              const nativeError = playerErrorEvent.nativeEvent ?? e
              const nativeTarget = nativeError as { target?: { error?: MediaError | null } | null }
              const mediaError = playerErrorEvent.target?.error ?? nativeTarget.target?.error ?? videoElementRef.current?.error ?? null

              if (import.meta.env.DEV) {
                console.warn('Player error event:', nativeError)
              }

              const failure = classifyMediaError(mediaError) ?? classifyPlaybackException(nativeError)
              if (!failure) return
              failureHandlerRef.current(
                failure,
                failure.kind === 'network' ? 'network_error' : failure.kind === 'decoder' || failure.kind === 'media' ? 'media_error' : 'fatal_error',
              )
            }}
          />
        </React.Suspense>

      {loaderVariant && (
        <SportZoneBDLoader
          variant={loaderVariant}
          label={loaderLabel}
          // The compact mini surface has no centred transport control, so the loader stays centred there
          // and cannot be clipped by a very small player.
          className={compactControls ? 'translate-y-0 sm:translate-y-0' : undefined}
        />
      )}

      {qualityToast && <div className="pointer-events-none absolute bottom-24 left-1/2 z-35 -translate-x-1/2 rounded-full border border-[#A8C4EC]/20 bg-[#262B40]/90 px-3 py-1.5 text-xs font-semibold text-[#A8C4EC] shadow-lg backdrop-blur-md" role="status" aria-live="polite">{qualityToast}</div>}

      {showNoSignal && <NoSignalOverlay />}

      <AnimatePresence>
        {playerError && (
          <motion.div
            key="error-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={`absolute inset-0 z-30 flex flex-col items-center justify-center text-white backdrop-blur-sm ${showNoSignal ? 'bg-linear-to-br from-black/65 via-black/55 to-black/65' : 'bg-linear-to-br from-black/80 via-black/75 to-black/80'}`}
          >
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="text-center"
            >
              <AlertCircle className="mx-auto mb-4 h-14 w-14 text-red-400" />
              <h3 className="text-xl font-bold text-white/95">Playback Error</h3>
              <p className="mt-2 max-w-xs text-center text-sm text-gray-300/80">{playerError}</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="inline-flex items-center gap-2 rounded-full bg-(--accent) px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-(--accent-secondary) shadow-lg"
                  onClick={handleRetry}
                >
                  <RotateCcw size={16} />
                  Retry stream
                </motion.button>
                {showAlternateStreamAction && (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-white/10"
                    onClick={() => {
                      const failedUrl = typeof url === 'string' ? url.trim() : ''
                      if (failedUrl && onStreamFallback?.(failedUrl)) {
                        // The owner of the list applied another candidate; the new source key resets the lifecycle.
                        fallbackRequestedUrlRef.current = failedUrl
                        dispatchLifecycle({ type: 'AWAIT_CANDIDATE', sourceKey })
                        return
                      }
                      handleRetry()
                    }}
                  >
                    <Server size={16} />
                    Try another stream
                  </motion.button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
        {isLocked && !playerError && (
          <motion.div
            key="locked-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={`absolute inset-0 z-40 flex items-end justify-center bg-transparent pb-5 sm:items-center sm:pb-0 ${controlsVisible ? '' : 'pointer-events-none'}`}
          >
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              // The unlock affordance auto-hides with the rest of the chrome, can be brought back by any
              // interaction, and stays in the tab order so a keyboard can always reach it.
              className={`flex min-h-11 items-center gap-2 rounded-full border border-cyan-400/30 bg-black/75 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition-opacity duration-200 hover:bg-black/85 hover:border-cyan-400/50 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none motion-reduce:transition-none ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
              onClick={handleUnlockScreen}
              aria-label="Unlock screen"
            >
              <Unlock className="h-4 w-4" />
              Screen locked
            </motion.button>
          </motion.div>
        )}
        {!isLocked && <PlayerControls
          isPlaying={isPlaying}
          isMuted={isMuted}
          volume={volume}
          played={played}
          duration={duration}
          progressRatio={liveWindow.hasTimeshift
            ? Math.min(1, Math.max(0, (liveWindow.currentTime - liveWindow.liveStart) / Math.max(liveWindow.liveEdge - liveWindow.liveStart, 0.001)))
            : duration > 0 ? Math.min(1, Math.max(0, played / duration)) : 0}
          isFullscreen={isFullscreen}
          hasError={!!playerError}
          controlsVisible={controlsVisible}
          isSettingsOpen={isSettingsOpen}
          activeSettingsSection={activeSettingsSection}
          playbackRate={playbackRate}
          subtitlesEnabled={subtitlesEnabled}
          isPiPSupported={isPiPSupported}
          isPiPActive={isPiPActive}
          compactControls={compactControls}
          bufferedAmount={bufferedAmount}
          liveWindow={liveWindow}
          qualityLevels={activeQualityLevels}
          currentLevel={currentLevel}
          playbackRates={playbackRates}
          subtitleChoices={subtitleChoices}
          selectedSubtitleLanguage={selectedSubtitleLanguage}
          settingsButtonRef={settingsButtonRef}
          settingsMenuRef={settingsMenuRef}
          volumeContainerRef={volumeContainerRef}
          onPlayPause={handlePlayPause}
          onVolumeButtonClick={handleVolumeButtonClick}
          onVolumeKeyDown={handleVolumeSliderKeyDown}
          onVolumeChange={handleVolumeInputChange}
          onSeekMouseDown={(event) => handleSeekMouseDown(event)}
          onSeekChange={handleSeekChange}
          onSeekMouseUp={(event) => handleSeekMouseUp(event)}
          onSeekBackward={handleSeekBackward}
          onSeekForward={handleSeekForward}
          showSeekControls={showSeekControls}
          onSettingsToggle={() => { setActiveSettingsSection('root'); dispatch({ type: 'TOGGLE_SETTINGS' }) }}
          onSettingsSectionChange={setActiveSettingsSection}
          onQualityChange={handleSetQuality}
          onPlaybackRateChange={handleSetPlaybackRate}
          onSubtitleChange={handleSetSubtitleLanguage}
          onToggleSubtitles={handleToggleSubtitles}
          onLock={handleLockScreen}
          onPiPToggle={() => { void handleTogglePictureInPicture() }}
          onFullscreenToggle={() => { void handleToggleFullscreen() }}
          onRetry={handleRetry}
          isRetrying={lifecycle.status === 'retrying'}
          onSurfaceClick={handleControlsSurfaceClick}
          onSurfaceDoubleClick={handleControlsSurfaceDoubleClick}
          onMouseMove={handlePlayerPointerMove}
          onMouseEnter={handlePlayerPointerEnter}
          matchMetadata={matchMetadata}
        />}
      </AnimatePresence>
      </div>
    </TooltipProvider>
  )
}