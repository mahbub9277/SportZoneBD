import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGetPublicChannelsQuery } from '../../features/admin/channels.api'
import { useAppSelector } from '../../app/hooks'
import { selectIsPremiumSubscriber } from '../../features/auth/authSlice'
import { SocketProvider } from '../../hooks/useSocket'
import { usePerformanceProfile } from '../../hooks/usePerformanceProfile'
import {
  buildTVCategories,
  buildTVChannels,
  filterTVChannels,
  findChannelByNumber,
  nextPlayableChannelId,
  pickInitialChannelId,
  stepChannelId,
  TV_ALL_CATEGORY_ID,
  type TVChannel,
} from './tvChannels'
import { readLastTVChannelId, writeLastTVChannelId } from './tvStorage'
import { useTVFocus } from './useTVFocus'
import { useAutoTune } from './useAutoTune'
import { TVChannelPanel } from './components/TVChannelPanel'
import { TVAutoTuneOverlay } from './components/TVAutoTuneOverlay'
import { TVPlayerStage, type TVTransport } from './components/TVPlayerStage'

const PREVIOUS_ROUTE_KEY = 'sportzone:user-previous-route'

/**
 * How long the viewer waits before TV Mode takes over a channel that reported a confirmed terminal
 * playback failure. It sits in the 3–5 second band, long enough for the player's own retry to be seen
 * and for the viewer to start reacting.
 */
const PLAYBACK_FAILURE_RECOVERY_MS = 4000

/** A channel the catalogue itself says cannot play gets the longer no-signal budget. */
const NO_SIGNAL_RECOVERY_MS = 5000

/**
 * Automatic switches allowed per failure burst. Repeated failures have to stop somewhere, and leaving the
 * viewer with the error UI and the channel list beats hopping through a provider outage forever.
 */
const MAX_AUTO_SWITCHES = 3

/**
 * The Screen Orientation API's lock/unlock are not in the DOM typings, and they are unsupported or
 * rejected on most devices, so they are reached defensively and every failure is ignored.
 */
interface LockableOrientation {
  type?: string
  lock?: (orientation: 'landscape' | 'portrait' | 'any') => Promise<void>
  unlock?: () => void
}

/**
 * TV Mode.
 *
 * A separate, lightweight experience with its own shell: no site header, sidebar, footer or bottom
 * navigation. The channel data, authentication, access rules and the player are all the existing ones —
 * this screen only arranges them for a remote control.
 *
 * The player is deliberately kept out of the channel-browser state: refreshing, filtering and searching
 * only ever change the list on the left, so a stream that is playing keeps playing. Switching channels
 * changes the player's source, which is the player's own proven path — the component is never remounted.
 */
function TVModeExperience() {
  const navigate = useNavigate()
  const { shouldReduceEffects, isSmartTV } = usePerformanceProfile()
  const isPremiumSubscriber = useAppSelector(selectIsPremiumSubscriber)

  const { data: categoryData, isLoading, isFetching, refetch } = useGetPublicChannelsQuery()

  const channels = useMemo(() => buildTVChannels(categoryData), [categoryData])
  const categories = useMemo(() => buildTVCategories(categoryData, channels), [categoryData, channels])

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [activeCategoryId, setActiveCategoryId] = useState<string>(TV_ALL_CATEGORY_ID)
  const [query, setQuery] = useState('')
  const [isImmersive, setImmersive] = useState(false)
  const [isKeypadOpen, setKeypadOpen] = useState(false)
  const [isAutoTuneOpen, setAutoTuneOpen] = useState(false)
  /** Bumped to ask the player stage to show the channel popup again, including for the same channel. */
  const [infoRequest, setInfoRequest] = useState(0)

  /** Either overlay takes focus for as long as it is open; the shell stops managing it until it closes. */
  const isOverlayOpen = isKeypadOpen || isAutoTuneOpen

  const shellRef = useRef<HTMLDivElement | null>(null)
  const transportRef = useRef<TVTransport | null>(null)
  const initialisedRef = useRef(false)
  const orientationRequestedRef = useRef(false)

  // The automatic-recovery scheduling is deliberately ref-based: it must read the selection, the
  // catalogue and the subscription state as they are when its timeout fires, never as they were when it
  // was scheduled, so a stale callback can never switch a channel the viewer has already left.
  const selectedChannelIdRef = useRef<string | null>(null)
  const channelsRef = useRef<TVChannel[]>([])
  const premiumSubscriberRef = useRef(isPremiumSubscriber)
  const recoveryTimerRef = useRef<number | null>(null)
  /** Channels that already failed in this session, and the automatic switches spent on them. */
  const recoveryRef = useRef<{ failedIds: Set<string>; switches: number } | null>(null)

  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId
  }, [selectedChannelId])

  useEffect(() => {
    channelsRef.current = channels
  }, [channels])

  useEffect(() => {
    premiumSubscriberRef.current = isPremiumSubscriber
  }, [isPremiumSubscriber])

  const channelsInCategory = useMemo(
    () => filterTVChannels(channels, { categoryId: activeCategoryId }),
    [activeCategoryId, channels],
  )
  const visibleChannels = useMemo(
    () => filterTVChannels(channels, { categoryId: activeCategoryId, query }),
    [activeCategoryId, channels, query],
  )

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  )

  // The opening channel: the viewer's last one when it is still playable, otherwise the first live one.
  useEffect(() => {
    if (initialisedRef.current || channels.length === 0) return
    initialisedRef.current = true
    startTransition(() => setSelectedChannelId(pickInitialChannelId(channels, readLastTVChannelId())))
  }, [channels])

  useEffect(() => {
    if (selectedChannelId) writeLastTVChannelId(selectedChannelId)
  }, [selectedChannelId])

  /**
   * Refresh is metadata only.
   *
   * The list is rebuilt from the fresh response while the selection is kept for as long as the channel
   * still exists: its stream url, and therefore the player's source key, are unchanged, so the running
   * stream is not restarted by a refresh. Only a channel that genuinely disappeared falls back.
   */
  const handleRefresh = useCallback(() => {
    void refetch()
  }, [refetch])

  useEffect(() => {
    if (isLoading || channels.length === 0) return
    if (selectedChannelId && !channels.some((channel) => channel.id === selectedChannelId)) {
      startTransition(() => setSelectedChannelId(pickInitialChannelId(channels, null)))
    }
  }, [channels, isLoading, selectedChannelId])

  /**
   * Automatic recovery.
   *
   * The player already owns retrying a source: it re-tries the same transport, then the alternate ones,
   * and only calls back when it is genuinely out of options. So a callback here is a *confirmed terminal*
   * failure, never a stall or a buffering hiccup, and the only decision left is which channel to try next.
   *
   * It is bounded three ways, so a provider outage cannot turn into a channel-hopping loop: the timer is
   * single and cleared before replacement, channels that already failed are remembered and never
   * revisited, and the number of automatic switches per burst is capped.
   */
  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
    }
  }, [])

  /** Ends the cycle: for a manual selection, recovered playback, or leaving TV Mode. */
  const cancelRecovery = useCallback(() => {
    clearRecoveryTimer()
    recoveryRef.current = null
  }, [clearRecoveryTimer])

  const scheduleRecovery = useCallback((failedChannelId: string, delayMs: number) => {
    const cycle = recoveryRef.current ?? { failedIds: new Set<string>(), switches: 0 }
    cycle.failedIds.add(failedChannelId)
    recoveryRef.current = cycle

    clearRecoveryTimer()
    if (cycle.switches >= MAX_AUTO_SWITCHES) return

    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null
      // Re-checked when it fires: the viewer may have moved on, or playback may have come back.
      if (selectedChannelIdRef.current !== failedChannelId) return

      const attempted = recoveryRef.current
      const nextId = nextPlayableChannelId(
        channelsRef.current,
        failedChannelId,
        (channel) =>
          (!channel.isPremium || premiumSubscriberRef.current)
          && !(attempted?.failedIds.has(channel.id) ?? false),
      )
      // No eligible alternative leaves the error UI and the channel list in charge.
      if (!nextId) return

      if (attempted) attempted.switches += 1
      setSelectedChannelId(nextId)
    }, delayMs)
  }, [clearRecoveryTimer])

  /** The player reports a confirmed terminal failure, named with the channel that produced it. */
  const handleChannelPlaybackError = useCallback((channelId: string) => {
    if (channelId !== selectedChannelIdRef.current) return
    scheduleRecovery(channelId, PLAYBACK_FAILURE_RECOVERY_MS)
  }, [scheduleRecovery])

  /**
   * A channel the catalogue itself says cannot play is the other confirmed no-signal case, and it runs on
   * the longer budget. A locked premium channel is restricted rather than broken, so it is left alone —
   * that decision belongs to the existing subscription gate, not to a recovery timer.
   */
  useEffect(() => {
    const channel = channels.find((candidate) => candidate.id === selectedChannelId)
    if (!channel) return
    if (channel.isPremium && !isPremiumSubscriber) return
    if (channel.isLive && channel.streamUrl) return
    scheduleRecovery(channel.id, NO_SIGNAL_RECOVERY_MS)
  }, [channels, isPremiumSubscriber, scheduleRecovery, selectedChannelId])

  // Nothing may keep running after TV Mode is left.
  useEffect(() => () => clearRecoveryTimer(), [clearRecoveryTimer])

  const selectChannel = useCallback((channel: TVChannel) => {
    // A deliberate selection ends whatever recovery was pending: the viewer's choice always wins over a
    // scheduled switch, and the failure cycle starts again from here.
    cancelRecovery()
    // Selecting the channel that is already playing is a no-op, so pressing OK on it never interrupts
    // playback — the popup is simply asked for again.
    setInfoRequest((request) => request + 1)
    setSelectedChannelId((current) => (current === channel.id ? current : channel.id))
  }, [cancelRecovery])

  const stepChannel = useCallback((direction: 1 | -1) => {
    cancelRecovery()
    setInfoRequest((request) => request + 1)
    setSelectedChannelId((current) => stepChannelId(channelsRef.current, current, direction) ?? current)
  }, [cancelRecovery])

  /**
   * Auto Tune.
   *
   * Accepting a scan tunes through the same selection function every other path uses, so access rules
   * are identical, and starting one stops any automatic recovery that was pending: while the viewer is
   * scanning, TV Mode must not switch channels behind them.
   */
  const autoTune = useAutoTune({
    channels,
    isPremiumSubscriber,
    selectedChannelId,
    onAccept: selectChannel,
    onScanStart: cancelRecovery,
  })

  /** Exit leaves TV Mode: it releases any native fullscreen first, then navigates away. */
  const handleExit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
    // Return to wherever the viewer came from, using the previous-route record the rest of the app
    // already keeps, and never reloading the page.
    const previous = window.sessionStorage.getItem(PREVIOUS_ROUTE_KEY)
    if (previous && previous !== '/tv') navigate(previous)
    else navigate('/')
  }, [navigate])

  /** The UI Back button hides the channel panel and gives the player the whole viewport, staying in TV Mode. */
  const enterPlayerView = useCallback(() => setImmersive(true), [])

  /**
   * The browser/remote Back keeps its hardened priority: native fullscreen first, then the focused-player
   * layout, and only when neither is active does Back leave TV Mode.
   */
  const handleBack = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined)
      return
    }
    if (isImmersive) {
      setImmersive(false)
      return
    }
    handleExit()
  }, [handleExit, isImmersive])

  const togglePlayback = useCallback(() => {
    transportRef.current?.playPause()
  }, [])

  const handleTransportReady = useCallback((transport: TVTransport | null) => {
    transportRef.current = transport
    // Real playback again means the failure is over: nothing pending is still worth doing, and the
    // automatic-switch budget is renewed for whatever fails next. The failed channels stay remembered,
    // which is what makes re-trying one impossible for the rest of the session.
    if (transport?.isPlaying) {
      clearRecoveryTimer()
      if (recoveryRef.current) recoveryRef.current.switches = 0
    }
  }, [clearRecoveryTimer])

  const { handleKeyDown, focusZone } = useTVFocus(shellRef, {
    onBack: handleBack,
    onChannelStep: stepChannel,
    onTogglePlayback: togglePlayback,
    preferredKey: selectedChannelId ? `channel:${selectedChannelId}` : null,
    listVersion: `${activeCategoryId}|${query}|${visibleChannels.length}`,
    // An open overlay owns focus; the shell must not pull it back on a channel change underneath.
    suspendAutoFocus: isOverlayOpen,
  })

  // Hardware Back leaves the focused player first, exactly like the in-app Back button: the immersive
  // state owns one history entry, and going back from it returns to the split layout.
  useEffect(() => {
    if (!isImmersive) return
    window.history.pushState({ tvImmersive: true }, '')
    const handlePopState = () => setImmersive(false)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      // Leaving immersive with the button or Escape must not strand its history entry, or the next Back
      // press would be swallowed by it. Only an entry that is still the current one is removed, so
      // navigating away from TV Mode can never be undone here.
      if (window.history.state?.tvImmersive) window.history.back()
    }
  }, [isImmersive])

  /**
   * Focus follows the layout.
   *
   * Immersive mode hides the panel, which would otherwise blur whatever was focused and leave focus
   * nowhere at all, so focus moves to the player's controls; leaving immersive hands it back to the
   * channel that is playing. Both directions are plain DOM focus, not state.
   */
  useEffect(() => {
    focusZone(isImmersive ? 'player' : 'channels', isImmersive ? 'stage' : selectedChannelId ? `channel:${selectedChannelId}` : null)
  }, [focusZone, isImmersive, selectedChannelId])

  /**
   * Focus follows the layout.
   *
   * Immersive mode hides the panel, which would otherwise blur whatever was focused and leave focus
   * nowhere at all, so focus moves to the player's controls; leaving immersive hands it back to the
   * channel that is playing. Both directions are plain DOM focus, not state.
   *
   * While an overlay is open it owns focus, so nothing behind it — a channel change, a scheduled
   * recovery, a filtered list — can pull the viewer out of what they are doing; closing the overlay
   * hands focus back through this same effect.
   */
  useEffect(() => {
    if (isOverlayOpen) return
    focusZone(isImmersive ? 'player' : 'channels', isImmersive ? 'stage' : selectedChannelId ? `channel:${selectedChannelId}` : null)
  }, [focusZone, isImmersive, isOverlayOpen, selectedChannelId])

  /**
   * The keypad is an overlay of the stage.
   *
   * Opening it only suspends the shell's own focus restore — the player, the stream and the layout are
   * untouched — and every key it handles stops travelling to the shell, so typing a number can never
   * also zap a channel behind it.
   */
  const toggleKeypad = useCallback(() => {
    // The two overlays are mutually exclusive: whichever the viewer opens takes the stage, so neither
    // can end up typing into the other.
    setAutoTuneOpen(false)
    setKeypadOpen((open) => !open)
  }, [])

  const closeKeypad = useCallback(() => setKeypadOpen(false), [])

  /** A tuned number goes through the same selection path as a channel card, so access rules are unchanged. */
  const tuneFromKeypad = useCallback((channel: TVChannel) => {
    setKeypadOpen(false)
    selectChannel(channel)
  }, [selectChannel])

  /** Auto Tune is the same deal in the other direction: it takes focus, and the keypad steps aside. */
  const openAutoTune = useCallback(() => {
    setKeypadOpen(false)
    setAutoTuneOpen(true)
    autoTune.start()
  }, [autoTune])

  const closeAutoTune = useCallback(() => {
    autoTune.cancel()
    setAutoTuneOpen(false)
  }, [autoTune])

  /** Retry from the empty and failed states without leaving the overlay. */
  const retryAutoTune = useCallback(() => autoTune.start(), [autoTune])

  /** The viewer accepts the result: tune, close, and let the existing channel popup confirm it. */
  const acceptAutoTune = useCallback(() => {
    setAutoTuneOpen(false)
    autoTune.accept()
  }, [autoTune])

  /** Resolution reads the catalogue as it is now, so a refresh is reflected without re-creating the keypad. */
  const resolveChannelNumber = useCallback(
    (digits: string) => findChannelByNumber(channelsRef.current, digits),
    [],
  )

  // Landscape is requested once, and only for the case the API exists for: a touch device that is
  // actually in portrait. A rejected or missing Screen Orientation API (Chrome requires fullscreen for
  // it, most desktop browsers refuse outright) is an expected browser limitation — TV Mode keeps working
  // in portrait, nothing is retried, and no error is shown.
  useEffect(() => {
    if (orientationRequestedRef.current) return
    orientationRequestedRef.current = true

    const orientation = window.screen?.orientation as LockableOrientation | undefined
    if (!orientation || typeof orientation.lock !== 'function') return
    if (typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: coarse)').matches) return

    const portrait = orientation.type
      ? orientation.type.startsWith('portrait')
      : window.innerHeight > window.innerWidth
    if (!portrait) return

    void orientation.lock('landscape').catch(() => undefined)
    return () => {
      // Releasing on the way out means the rest of the app is never left rotated by TV Mode.
      try {
        orientation.unlock?.()
      } catch {
        // Some browsers throw when nothing was locked; that is not worth surfacing.
      }
    }
  }, [])

  const handleUpgrade = useCallback(() => navigate('/subscriptions'), [navigate])

  // "Back to channels" in the split layout means handing focus and the list back to the viewer, which is
  // what a remote needs; nothing about the player changes.
  const focusChannels = useCallback(() => {
    focusZone('channels', selectedChannelId ? `channel:${selectedChannelId}` : null)
  }, [focusZone, selectedChannelId])

  return (
    <div
      ref={shellRef}
      onKeyDown={handleKeyDown}
      className={`tv-shell${shouldReduceEffects || isSmartTV ? ' tv-lite' : ''}${isImmersive ? ' tv-immersive' : ''}`}
    >
      <TVChannelPanel
        categories={categories}
        channels={visibleChannels}
        channelsByCategory={channelsInCategory}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        selectedChannelId={selectedChannelId}
        activeCategoryId={activeCategoryId}
        query={query}
        isPremiumSubscriber={isPremiumSubscriber}
        onEnterPlayerView={enterPlayerView}
        onExit={handleExit}
        onRefresh={handleRefresh}
        onSelectCategory={setActiveCategoryId}
        onQueryChange={setQuery}
        onSelectChannel={selectChannel}
      />

      <TVPlayerStage
        channel={selectedChannel}
        isPremiumLocked={Boolean(selectedChannel?.isPremium) && !isPremiumSubscriber}
        isImmersive={isImmersive}
        isKeypadOpen={isKeypadOpen}
        autoTuneStatus={autoTune.status}
        infoRequest={infoRequest}
        onToggleImmersive={() => setImmersive((immersive) => !immersive)}
        onToggleKeypad={toggleKeypad}
        onToggleAutoTune={openAutoTune}
        onCloseKeypad={closeKeypad}
        onTuneChannel={tuneFromKeypad}
        resolveChannelNumber={resolveChannelNumber}
        onChannelPlaybackError={handleChannelPlaybackError}
        onStepChannel={stepChannel}
        onTransportReady={handleTransportReady}
        onUpgrade={handleUpgrade}
        onBackToChannels={focusChannels}
      />

      {/* Auto Tune sits above the whole shell: it is a modal scan, so nothing behind it takes focus or a
          click while it runs. Closing it — by finishing, cancelling or Escape — returns the viewer to
          exactly the layout and channel they left. */}
      {isAutoTuneOpen && autoTune.status !== 'idle' && (
        <TVAutoTuneOverlay
          status={autoTune.status}
          scanned={autoTune.scanned}
          total={autoTune.total}
          currentChannel={autoTune.currentChannel}
          found={autoTune.found}
          onCancel={closeAutoTune}
          onRetry={retryAutoTune}
          onStartWatching={acceptAutoTune}
          onClose={closeAutoTune}
        />
      )}
    </div>
  )
}

/** TV Mode needs the socket provider (the player publishes presence through it) but none of the site chrome. */
export function TVModePage() {
  return (
    <SocketProvider>
      <TVModeExperience />
    </SocketProvider>
  )
}
