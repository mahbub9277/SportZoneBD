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
  pickInitialChannelId,
  stepChannelId,
  TV_ALL_CATEGORY_ID,
  type TVChannel,
} from './tvChannels'
import { readLastTVChannelId, writeLastTVChannelId } from './tvStorage'
import { useTVFocus } from './useTVFocus'
import { TVChannelPanel } from './components/TVChannelPanel'
import { TVPlayerStage, type TVTransport } from './components/TVPlayerStage'

const PREVIOUS_ROUTE_KEY = 'sportzone:user-previous-route'

/**
 * The Screen Orientation API's lock/unlock are not in the DOM typings, and they are unsupported or
 * rejected on most devices, so they are reached defensively and every failure is ignored.
 */
interface LockableOrientation {
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

  const shellRef = useRef<HTMLDivElement | null>(null)
  const transportRef = useRef<TVTransport | null>(null)
  const initialisedRef = useRef(false)
  const orientationRequestedRef = useRef(false)

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

  const selectChannel = useCallback((channel: TVChannel) => {
    // Selecting the channel that is already playing is a no-op, so pressing OK on it never interrupts
    // playback.
    setSelectedChannelId((current) => (current === channel.id ? current : channel.id))
  }, [])

  const stepChannel = useCallback((direction: 1 | -1) => {
    setSelectedChannelId((current) => stepChannelId(channels, current, direction) ?? current)
  }, [channels])

  const handleBack = useCallback(() => {
    // Deterministic Back priority: a live native fullscreen (entered from the player's own button)
    // owns Back first, then the TV focused-player layout, and only then does Back leave TV Mode.
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined)
      return
    }
    if (isImmersive) {
      setImmersive(false)
      return
    }
    // Return to wherever the viewer came from, using the previous-route record the rest of the app
    // already keeps, and never reloading the page.
    const previous = window.sessionStorage.getItem(PREVIOUS_ROUTE_KEY)
    if (previous && previous !== '/tv') navigate(previous)
    else navigate('/')
  }, [isImmersive, navigate])

  const togglePlayback = useCallback(() => {
    transportRef.current?.playPause()
  }, [])

  const handleTransportReady = useCallback((transport: TVTransport | null) => {
    transportRef.current = transport
  }, [])

  const { handleKeyDown, focusZone } = useTVFocus(shellRef, {
    onBack: handleBack,
    onChannelStep: stepChannel,
    onTogglePlayback: togglePlayback,
    preferredKey: selectedChannelId ? `channel:${selectedChannelId}` : null,
    listVersion: `${activeCategoryId}|${query}|${visibleChannels.length}`,
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

  // Landscape is requested once per visit and only where the browser supports it. A rejected or missing
  // Screen Orientation API changes nothing: TV Mode works in portrait as well.
  useEffect(() => {
    if (orientationRequestedRef.current) return
    orientationRequestedRef.current = true

    const orientation = window.screen?.orientation as LockableOrientation | undefined
    if (!orientation || typeof orientation.lock !== 'function') return

    void orientation.lock('landscape').catch(() => undefined)
    return () => {
      void orientation.unlock?.()
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
        onBack={handleBack}
        onRefresh={handleRefresh}
        onSelectCategory={setActiveCategoryId}
        onQueryChange={setQuery}
        onSelectChannel={selectChannel}
      />

      <TVPlayerStage
        channel={selectedChannel}
        isPremiumLocked={Boolean(selectedChannel?.isPremium) && !isPremiumSubscriber}
        isImmersive={isImmersive}
        onToggleImmersive={() => setImmersive((immersive) => !immersive)}
        onStepChannel={stepChannel}
        onTransportReady={handleTransportReady}
        onUpgrade={handleUpgrade}
        onBackToChannels={focusChannels}
      />
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
