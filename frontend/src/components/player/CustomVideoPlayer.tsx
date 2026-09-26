import React, { startTransition, useState, useRef, useEffect, useCallback, useMemo, useReducer } from 'react'
import { Unlock, Tv, RotateCcw, AlertCircle } from 'lucide-react'

import { motion, AnimatePresence } from 'framer-motion'
import { TooltipProvider } from '../ui/Tooltip'
import { useHlsPlayer } from '../../hooks/useHlsPlayer'
import { useLowPowerDevice } from '../../hooks/useLowPowerDevice'
import { useSocket } from '../../hooks/useSocket'
import { usePlayerTelemetry } from '../../hooks/usePlayerTelemetry'
import { useAutoHideControls } from '../../hooks/useAutoHideControls'
import { useSubtitles } from '../../hooks/useSubtitles'
import { useFullscreen } from '../../hooks/useFullscreen'
import { usePictureInPicture } from '../../hooks/usePictureInPicture'
import { PlayerControls, type MatchPlayerMetadata } from './PlayerControls'
import { getPlayerContainerClass } from './playerLayout'
import { getActualHlsCurrentLevel, normalizeQualityLevels } from './qualityUtils'
import { isHlsPlayer, type HlsEventData, type HlsPlayer, type QualityLevel, type ReactPlayerInstance, type SubtitleTrack } from './player.types'

export type { SubtitleTrack } from './player.types'

export interface CustomVideoPlayerProps {
  url?: string | null
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
  subtitles?: SubtitleTrack[];
  matchMetadata?: MatchPlayerMetadata
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
  subtitles,
  presenceId,
  presenceType = 'stream',
  matchId,
  channelId,
  matchMetadata,
}: CustomVideoPlayerProps) {
  const { socket } = useSocket()
  const { isLowPower } = useLowPowerDevice() // Changed to use useLowPowerDevice hook
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
  const [refreshKey, setRefreshKey] = useState(0)
  const [, setHasNativeMediaReady] = useState(false)
  const [qualityToast, setQualityToast] = useState<string | null>(null)
  const { currentUrl, errorMessage, retry, setError } = useHlsPlayer(url, streamId)
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
  const timelineInputRef = useRef<HTMLInputElement | null>(null)
  const timelineProgressRef = useRef<HTMLDivElement | null>(null)
  const timelineBufferedRef = useRef<HTMLDivElement | null>(null)
  const timelineSeekableRef = useRef<HTMLDivElement | null>(null)
  const lastMediaTimeRef = useRef<number | null>(null)
  const prevVolumeRef = useRef(0.8)
  const volumePointerCleanupRef = useRef<(() => void) | null>(null)
  const hlsLevelSwitchListenerRef = useRef<((event: string, data: { level?: number }) => void) | null>(null)
  const hlsRef = useRef<HlsPlayer | null>(null)
  const sourceGenerationRef = useRef(0)
  const manualQualityRef = useRef(false)
  const sourceKey = `${streamId || ''}|${url || ''}`
  const currentSourceKeyRef = useRef(sourceKey)
  const terminatedRef = useRef(false)
  const previousSourceKeyRef = useRef(sourceKey)
  const mediaLifecycleCleanupRef = useRef<(() => void) | null>(null)
  const hlsLifecycleCleanupRef = useRef<(() => void) | null>(null)
  const qualityToastTimeoutRef = useRef<number | null>(null)
  const presenceActiveRef = useRef(false)
  const presenceKeyRef = useRef<string | null>(null)
  const presenceIdentity = presenceId || streamId || null
  const { track: trackTelemetry } = usePlayerTelemetry({
    streamId,
    channelId: channelId || (presenceType === 'channel' ? presenceId : undefined),
    matchId,
    active: isPlaying,
  })

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
    const heartbeat = window.setInterval(() => {
      if (presenceActiveRef.current && presenceIdentity && socket.connected) {
        socket.emit('viewerHeartbeat', { streamId: presenceIdentity, kind: presenceType })
      }
    }, 30000)
    return () => {
      socket.off('connect', handleConnect)
      window.clearInterval(heartbeat)
    }
  }, [presenceIdentity, presenceType, socket])

  const playbackRates = useMemo(
    () => (isLowPower ? LOW_POWER_PLAYBACK_RATES : PLAYBACK_RATES),
    [isLowPower]
  )
  const { choices: subtitleChoices, selectedLanguage: selectedSubtitleLanguage, subtitlesEnabled, preferredLanguage, applyLanguage: applySubtitleLanguage, refreshNativeTracks } = useSubtitles(videoElementRef, subtitles)
  const { isFullscreen: isFullscreenFromHook, toggle: toggleFullscreen } = useFullscreen(playerContainerRef, isTouchDevice)
  const { isActive: isPiPActive, isSupported: isPiPSupported, toggle: togglePictureInPicture } = usePictureInPicture(videoElementRef)

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
    isLocked,
    hasError: !!playerError,
    isTouchDevice,
    isPointerInside: isPointerInsidePlayer,
    setVisible: setControlsVisible,
  })

  const handlePlayerPointerEnter = useCallback(() => {
    if (isTouchDevice || isLocked || isSettingsOpen) return
    setIsPointerInsidePlayer(true)
    showControls()
  }, [isLocked, isSettingsOpen, isTouchDevice, showControls])

  const handlePlayerPointerMove = useCallback(() => {
    if (isTouchDevice || isLocked || isSettingsOpen) return
    setIsPointerInsidePlayer(true)
    showControls()
  }, [isLocked, isSettingsOpen, isTouchDevice, showControls])

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

    const internalPlayer = playerRef.current?.getInternalPlayer?.()
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
      internalPlayer = activeHls || playerRef.current?.getInternalPlayer?.() || null
    } catch {
      internalPlayer = activeHls
    }

    const videos = new Set<HTMLMediaElement>()
    if (videoElementRef.current) videos.add(videoElementRef.current)
    if (internalPlayer instanceof HTMLMediaElement) videos.add(internalPlayer)
    playerContainerRef.current?.querySelectorAll('video').forEach((video) => videos.add(video))

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

    mediaLifecycleCleanupRef.current?.()
    mediaLifecycleCleanupRef.current = null
    hlsLifecycleCleanupRef.current?.()
    hlsLifecycleCleanupRef.current = null

    hlsRef.current = null

    if (hlsLevelSwitchListenerRef.current && isHlsPlayer(internalPlayer) && typeof internalPlayer.off === 'function') {
      try {
        internalPlayer.off('hlsLevelSwitched', hlsLevelSwitchListenerRef.current)
        internalPlayer.off('hlsManifestParsed', hlsLevelSwitchListenerRef.current)
      } catch {
        // Ignore cleanup failures during player shutdown.
      }
      hlsLevelSwitchListenerRef.current = null
    }

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
    updateTimelineDom()
  }, [dispatch, getLastTimeRange, getVideoElement, updateTimelineDom])

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

  const handlePlayPause = useCallback(() => {
    const video = getVideoElement()
    if (!video) {
      dispatch({ type: 'TOGGLE_PLAY' })
      return
    }

    if (video.paused || video.ended) {
      void video.play().catch(() => dispatch({ type: 'SET_PLAYING', payload: false }))
    } else {
      video.pause()
    }
  }, [getVideoElement])

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
    if (isLocked || isSettingsOpen) return

    const target = event.target as HTMLElement | null
    if (target?.closest('button, input, [role="button"], [role="slider"], [role="menu"]')) return

    if (showSeekControls) {
      showControls()
      return
    }

    if (isTouchDevice) {
      if (!controlsVisible) {
        showControls()
        return
      }

      toggleControls()
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
      applySubtitleLanguage(null)
      return
    }

    applySubtitleLanguage(preferredLanguage)
  }, [applySubtitleLanguage, preferredLanguage, selectedSubtitleLanguage, subtitleChoices.length])
  
  const handleSetSubtitleLanguage = useCallback((language: string | null) => { // Changed to use useCallback
    if (!subtitleChoices.length) return
    applySubtitleLanguage(language)
    dispatch({ type: 'TOGGLE_SETTINGS' })
    settingsButtonRef.current?.focus()
  }, [applySubtitleLanguage, dispatch, subtitleChoices.length])
  
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
    if (isLocked || compactControls || event.changedTouches.length !== 1) return

    const target = event.target as HTMLElement | null
    if (target?.closest('button, input, [role="button"], [role="slider"], [role="menu"]')) {
      writeRef(lastTouchRef, null)
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
  }, [compactControls, handleToggleFullscreen, isLocked])
  
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

  const handleRetry = useCallback(() => {
    stopPlayback()
    terminatedRef.current = false
    currentSourceKeyRef.current = sourceKey
    clearQualityToast()
    dispatch({ type: 'SET_ERROR', payload: null });
    dispatch({ type: 'SET_PLAYING', payload: false });
    setRefreshKey(prev => prev + 1)
    writeRef(proxyTriedRef, false)
    writeRef(proxyFailedRef, false)
    if (!retry()) {
      const exhaustedMessage = 'No alternate stream source is available. Please try again later.'
      dispatch({ type: 'SET_ERROR', payload: exhaustedMessage })
      if (typeof onPlayerError === 'function') {
        onPlayerError(exhaustedMessage)
      }
    }
  }, [clearQualityToast, retry, sourceKey, stopPlayback, onPlayerError])

  useEffect(() => {
    if (!resolvedUrl) return

    trackTelemetry('load_start')
  }, [resolvedUrl, sourceKey, trackTelemetry])

  const syncDuration = useCallback(() => { // Changed to use useCallback
    const nextDuration = playerRef.current?.getDuration?.()
    if (typeof nextDuration === 'number' && !Number.isNaN(nextDuration)) {
      dispatch({ type: 'SET_DURATION', payload: nextDuration });
    }
  }, [])
  
  const handleReady = useCallback(() => { // Changed to use useCallback
    if (terminatedRef.current || currentSourceKeyRef.current !== sourceKey) return

    setHasNativeMediaReady(true)

    const sourceGeneration = sourceGenerationRef.current
    const internalPlayer = playerRef.current?.getInternalPlayer?.()
    if (internalPlayer instanceof HTMLMediaElement) {
      videoElementRef.current = internalPlayer as HTMLMediaElement
      if (videoElementRef.current) {
        const nativeVolume = Number.isFinite(videoElementRef.current.volume) ? videoElementRef.current.volume : volume
        if (nativeVolume > 0) {
          prevVolumeRef.current = nativeVolume
        }
        videoElementRef.current.volume = volume
        videoElementRef.current.muted = isMuted
        videoElementRef.current.playbackRate = playbackRate
        videoElementRef.current.style.objectFit = 'contain'
      }

      mediaLifecycleCleanupRef.current?.()
      const media = internalPlayer
      const isCurrentMedia = () => !terminatedRef.current && sourceGenerationRef.current === sourceGeneration && currentSourceKeyRef.current === sourceKey && videoElementRef.current === media
      const handleMediaPlaying = () => {
        if (!isCurrentMedia()) return
        setHasNativeMediaReady(true)
        joinViewerPresence()
        trackTelemetry('playing')
        dispatch({ type: 'SET_PLAYING', payload: true })
      }
      const handleMediaError = () => {
        if (!isCurrentMedia()) return
        setHasNativeMediaReady(false)
      }
      const handlePause = () => {
        if (!isCurrentMedia()) return
        dispatch({ type: 'SET_PLAYING', payload: false })
      }
      media.addEventListener('playing', handleMediaPlaying)
      media.addEventListener('error', handleMediaError)
      media.addEventListener('pause', handlePause)
      mediaLifecycleCleanupRef.current = () => {
        media.removeEventListener('playing', handleMediaPlaying)
        media.removeEventListener('error', handleMediaError)
        media.removeEventListener('pause', handlePause)
      }
      if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        setHasNativeMediaReady(true)
      }
    }

    updateLiveWindow()

    syncDuration()
    let hlsPlayer: unknown = undefined
    try {
      const maybeFn = playerRef.current?.getInternalPlayer
      hlsPlayer = typeof maybeFn === 'function' ? maybeFn.call(playerRef.current) : playerRef.current
    } catch {
      hlsPlayer = playerRef.current
    }

    if (isHlsPlayer(hlsPlayer)) {
      hlsRef.current = hlsPlayer
      let activeLevels = normalizeQualityLevels(hlsPlayer.levels)
      const syncQualityState = () => {
        activeLevels = normalizeQualityLevels(hlsPlayer.levels)
        setQualityLevels(activeLevels)
        const nextCurrentLevel = getActualHlsCurrentLevel(hlsPlayer, activeLevels)
        setCurrentLevel(nextCurrentLevel)
        manualQualityRef.current = nextCurrentLevel >= 0 && !hlsPlayer.autoLevelEnabled
      }
      syncQualityState()

      if (hlsLevelSwitchListenerRef.current && typeof hlsPlayer.off === 'function') {
        try {
          hlsPlayer.off('hlsLevelSwitched', hlsLevelSwitchListenerRef.current)
          hlsPlayer.off('hlsManifestParsed', hlsLevelSwitchListenerRef.current)
        } catch {
          // ignore listener cleanup failures
        }
      }

      try {
        const handleQualityEvent = (event: string, data: HlsEventData) => {
            if (sourceGenerationRef.current !== sourceGeneration || hlsRef.current !== hlsPlayer) return
          if (event === 'hlsManifestParsed') {
            syncQualityState()
            return
          }

          const level = typeof data.level === 'number' ? data.level : -1
          trackTelemetry('bitrate_switch', { level })
          const nextCurrentLevel = getActualHlsCurrentLevel(hlsPlayer, activeLevels)
          const resolvedLevel = typeof hlsPlayer.autoLevelEnabled === 'boolean'
            ? (hlsPlayer.autoLevelEnabled ? -1 : level)
            : (nextCurrentLevel === -1 ? -1 : level)

          setCurrentLevel(resolvedLevel)
          manualQualityRef.current = resolvedLevel >= 0 && !hlsPlayer.autoLevelEnabled
          const actualLevel = activeLevels.find((item) => item.hlsIndex === resolvedLevel)
          if (actualLevel) showQualityToast(`${manualQualityRef.current ? 'Quality set to' : 'Quality optimizing'} ${actualLevel.height}p`)
        }

        hlsLevelSwitchListenerRef.current = handleQualityEvent
        hlsPlayer.on('hlsLevelSwitched', handleQualityEvent)
        hlsPlayer.on('hlsManifestParsed', handleQualityEvent)
      } catch {
        // ignore listener attach failures
      }

      const handleHlsFatalError = (event: string, data: HlsEventData) => {
        if (event !== 'hlsError' || !data.fatal) return
        if (terminatedRef.current || sourceGenerationRef.current !== sourceGeneration || currentSourceKeyRef.current !== sourceKey) return
        const currentInternalPlayer = playerRef.current?.getInternalPlayer?.()
        if (currentInternalPlayer !== hlsPlayer || hlsRef.current !== hlsPlayer) return

        const message = errorMessage || 'Unable to load this stream. Please try again later.'
        setError(message)
        dispatch({ type: 'SET_ERROR', payload: message })
        trackTelemetry('fatal_error', { details: data.details || 'hls_fatal_error' })
        onPlayerError?.(message)
      }

      hlsPlayer.on('hlsError', handleHlsFatalError)
      const previousHlsCleanup = hlsLifecycleCleanupRef.current
      previousHlsCleanup?.()
      hlsLifecycleCleanupRef.current = () => {
        if (typeof hlsPlayer.off === 'function') {
          hlsPlayer.off('hlsError', handleHlsFatalError)
        }
        if (hlsRef.current === hlsPlayer) hlsRef.current = null
      }
    }

    const nativeVideo = internalPlayer instanceof HTMLMediaElement ? internalPlayer : null
    if (nativeVideo) {
      const nextSubtitleTracks = Array.from(nativeVideo.textTracks || []).map((track, index) => ({
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
        refreshNativeTracks(nativeVideo)
        if (currentSelected) {
          applySubtitleLanguage(currentSelected)
        } else {
          applySubtitleLanguage(null)
        }
      } else {
        refreshNativeTracks(nativeVideo)
      }

      const refreshTracks = () => refreshNativeTracks(nativeVideo)
      nativeVideo.addEventListener('loadedmetadata', refreshTracks)
      nativeVideo.textTracks.addEventListener('addtrack', refreshTracks)
      nativeVideo.textTracks.addEventListener('removetrack', refreshTracks)
      const previousCleanup = mediaLifecycleCleanupRef.current
      mediaLifecycleCleanupRef.current = () => {
        previousCleanup?.()
        nativeVideo.removeEventListener('loadedmetadata', refreshTracks)
        nativeVideo.textTracks.removeEventListener('addtrack', refreshTracks)
        nativeVideo.textTracks.removeEventListener('removetrack', refreshTracks)
      }
    }
  }, [applySubtitleLanguage, errorMessage, isMuted, joinViewerPresence, onPlayerError, playbackRate, refreshNativeTracks, selectedSubtitleLanguage, setError, showQualityToast, sourceKey, subtitles, syncDuration, trackTelemetry, updateLiveWindow, volume])
  
  useEffect(() => { // Changed to use useEffect
    const tapTimeout = tapTimeoutRef
    return () => {
      stopPlayback()
      detachVolumeDragListeners()
      if (hlsLevelSwitchListenerRef.current) {
        const currentPlayer = playerRef.current?.getInternalPlayer?.()
        if (isHlsPlayer(currentPlayer) && typeof currentPlayer.off === 'function') {
          try {
            currentPlayer.off('hlsLevelSwitched', hlsLevelSwitchListenerRef.current)
            currentPlayer.off('hlsManifestParsed', hlsLevelSwitchListenerRef.current)
          } catch {
            // ignore cleanup failures
          }
        }
        hlsLevelSwitchListenerRef.current = null
      }
      if (tapTimeout.current !== null) {
        window.clearTimeout(tapTimeout.current)
        writeRef(tapTimeout, null)
      }
    }
  }, [detachVolumeDragListeners, stopPlayback])
  
  useEffect(() => { // Changed to use useEffect
    if (previousSourceKeyRef.current !== sourceKey) {
      stopPlayback()
      terminatedRef.current = false
      currentSourceKeyRef.current = sourceKey
      previousSourceKeyRef.current = sourceKey
      setRefreshKey((key) => key + 1)
    }

    writeRef(proxyTriedRef, false)
    writeRef(proxyFailedRef, false)
    if (qualityToastTimeoutRef.current !== null) window.clearTimeout(qualityToastTimeoutRef.current)
    writeRef(qualityToastTimeoutRef, null)
    startTransition(() => setQualityToast(null))
    startTransition(() => setHasNativeMediaReady(false))
    dispatch({ type: 'RESET_FOR_NEW_URL', payload: autoPlay })
    startTransition(() => {
      setQualityLevels([])
      setCurrentLevel(-1)
      setLiveWindow({ hasTimeshift: false, liveStart: 0, liveEdge: 0, currentTime: 0, isLive: false })
    })
    manualQualityRef.current = false
  }, [autoPlay, clearQualityToast, resolvedUrl, sourceKey, stopPlayback])
  
  const handleSetQuality = (levelIndex: number) => { // Changed to use handleSetQuality
    const internalPlayer: unknown = typeof playerRef.current?.getInternalPlayer === 'function'
      ? playerRef.current.getInternalPlayer()
      : playerRef.current;

    if (isHlsPlayer(internalPlayer)) {
      try {
        const selectedLevel = qualityLevels.find((level) => level.hlsIndex === levelIndex)
        const nextIndex = levelIndex < 0 ? -1 : (selectedLevel && typeof selectedLevel.hlsIndex === 'number' ? selectedLevel.hlsIndex : -1)

        manualQualityRef.current = levelIndex >= 0 && Boolean(selectedLevel)

        if (typeof internalPlayer.autoLevelEnabled === 'boolean') {
          Object.assign(internalPlayer, { autoLevelEnabled: levelIndex < 0 })
        }

        Object.assign(internalPlayer, { currentLevel: nextIndex })
        setCurrentLevel(levelIndex < 0 ? -1 : nextIndex)
        const selectedLabel = levelIndex < 0 ? 'Auto' : selectedLevel ? `${selectedLevel.height}p` : null
        if (selectedLabel) showQualityToast(`Quality set to ${selectedLabel}`)
      } catch {
        // Ignore invalid HLS level selection
      }
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
  }, [handleIncreaseSpeed, handleDecreaseSpeed, handlePlayPause, handleToggleFullscreen, handleToggleMute, handleTogglePictureInPicture, handleVolumeDown, handleVolumeUp, isLocked, seekBy])
  
  const proxyTriedRef = useRef(false) // Changed to use useRef
  const proxyFailedRef = useRef(false) // Changed to use useRef

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

    const events = ['timeupdate', 'progress', 'durationchange', 'loadedmetadata', 'canplay', 'seeking', 'seeked']
    events.forEach((eventName) => video.addEventListener(eventName, refreshLiveWindow))
    const liveWindowTimer = window.setInterval(refreshLiveWindow, 1000)
    refreshLiveWindow()

    return () => {
      events.forEach((eventName) => video.removeEventListener(eventName, refreshLiveWindow))
      window.clearInterval(liveWindowTimer)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [getVideoElement, resolvedUrl, updateLiveWindow, updateTimelineDom, url])

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
      xhrSetup: (xhr: XMLHttpRequest) => {
        xhr.withCredentials = false
      },
    }

    if (isLowPower) {
      return {
        ...baseOptions,
        maxBufferLength: 20,
        maxBufferSize: 20 * 1000 * 1000,
        backBufferLength: 12,
        liveSyncDurationCount: 3,
        maxMaxBufferLength: 30,
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
  }, [isLowPower])
  
  const playerConfig = useMemo<ReactPlayerProps['config']>(() => ({ // Changed to use useMemo
    file: {
      forceHLS: isHlsSource,
      attributes: {
        playsInline: true,
        poster: poster || undefined,
        crossOrigin: 'anonymous',
      },
      hlsOptions: isHlsSource ? hlsOptions : undefined,
      tracks: subtitles || [],
    },
  }) as ReactPlayerProps['config'], [hlsOptions, isHlsSource, poster, subtitles])

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

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={playerContainerRef}
        aria-busy={false}
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
            ref={playerRef as unknown as React.Ref<HTMLVideoElement>}
            src={resolvedUrl}
            playing={isPlaying && !!resolvedUrl}
            config={playerConfig}
            volume={isLowPower ? Math.min(volume, 0.7) : volume}
            muted={isMuted}
            playbackRate={isLowPower ? 1 : playbackRate}
            width="100%"
            height="100%"
            controls={false}
            onReady={() => {
              handleReady()
            }}
            onProgress={() => {
              updateTimelineDom()
            }}
            onEnded={() => {
              if (terminatedRef.current || currentSourceKeyRef.current !== sourceKey) return
              leaveViewerPresence()
              trackTelemetry('ended')
              dispatch({ type: 'SET_PLAYING', payload: false })
            }}
            playsInline={true}
            onError={(e: unknown) => {
              if (terminatedRef.current) return
              if (currentSourceKeyRef.current !== sourceKey) return

              const playerError = e as { nativeEvent?: unknown; target?: { error?: MediaError | null } | null }
              const nativeError = playerError.nativeEvent ?? e
              const videoElement = playerError.target
              const nativeTarget = nativeError as { target?: { error?: MediaError | null } | null }
              const mediaError = videoElement?.error ?? nativeTarget.target?.error ?? null
              const errorCode = typeof mediaError?.code === 'number' ? mediaError.code : null
              const errorMessageFromMedia = typeof mediaError?.message === 'string' ? mediaError.message : ''
              const decoderFailure = errorCode === 4 || /failed to init decoder|not suitable|media resource/i.test(errorMessageFromMedia)

              if (decoderFailure) {
                const friendly = 'This stream cannot be decoded by the current browser. Try another live channel or retry.'
                leaveViewerPresence()
                trackTelemetry('media_error', { code: errorCode ?? 0 })
                trackTelemetry('fatal_error')
                setError('This stream cannot be decoded by the current browser.')
                dispatch({ type: 'SET_ERROR', payload: friendly });
                if (typeof onPlayerError === 'function') {
                  onPlayerError(friendly)
                }
                return
              }

              if (process.env.NODE_ENV !== 'production') {
                console.warn('Player Error:', nativeError)
              }

              if (proxyTriedRef.current && proxyFailedRef.current) {
                const fallbackMessage = errorMessage || 'Unable to load this stream. Please try again later.'
                leaveViewerPresence()
                trackTelemetry('fatal_error')
                setError(fallbackMessage)
                dispatch({ type: 'SET_ERROR', payload: fallbackMessage });
                if (typeof onPlayerError === 'function') {
                  onPlayerError(fallbackMessage)
                }
                return
              }

              if (!proxyTriedRef.current && resolvedUrl) {
                writeRef(proxyTriedRef, true)
                writeRef(proxyFailedRef, true)
                trackTelemetry('network_error')
                if (!retry()) {
                  const exhaustedMessage = 'No alternate stream source is available. Please try again later.'
                  dispatch({ type: 'SET_ERROR', payload: exhaustedMessage })
                  if (typeof onPlayerError === 'function') {
                    onPlayerError(exhaustedMessage)
                  }
                  return
                }
                dispatch({ type: 'SET_ERROR', payload: null });
                return;
              } 

              const generic = errorMessage || 'Unable to load this stream. Please try a different channel or retry the stream.'
              leaveViewerPresence()
              trackTelemetry('network_error')
              setError(generic)
              dispatch({ type: 'SET_ERROR', payload: generic });
              if (typeof onPlayerError === 'function') {
                onPlayerError(generic)
              }
            }}
          />
        </React.Suspense>

      {qualityToast && <div className="pointer-events-none absolute bottom-24 left-1/2 z-35 -translate-x-1/2 rounded-full border border-[#A8C4EC]/20 bg-[#262B40]/90 px-3 py-1.5 text-xs font-semibold text-[#A8C4EC] shadow-lg backdrop-blur-md" role="status" aria-live="polite">{qualityToast}</div>}

      <AnimatePresence>
        {playerError && (
          <motion.div
            key="error-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-linear-to-br from-black/80 via-black/75 to-black/80 text-white backdrop-blur-sm"
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
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-(--accent) px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-(--accent-secondary) shadow-lg"
                onClick={handleRetry}
              >
                <RotateCcw size={16} />
                Retry stream
              </motion.button>
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
            className="absolute inset-0 z-40 flex items-end justify-center bg-transparent pb-5 sm:items-center sm:pb-0"
          >
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex min-h-11 items-center gap-2 rounded-full border border-cyan-400/30 bg-black/75 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition hover:bg-black/85 hover:border-cyan-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
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
          isTouchDevice={isTouchDevice}
          compactControls={compactControls}
          liveWindow={liveWindow}
          qualityLevels={qualityLevels}
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