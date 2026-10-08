import { ChevronLeft, ChevronRight, Loader2, Lock, Maximize2, Minimize2, Pause, Play } from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CustomVideoPlayer } from '../../../components/player/CustomVideoPlayer'
import { cn } from '../../../lib/utils'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { formatChannelNumber, type TVChannel } from '../tvChannels'

export interface TVTransport {
  playPause: () => void
  isPlaying: boolean
}

/** How long the channel popup and the control row stay on screen after the last interaction. */
const CONTROLS_IDLE_MS = 4000

/** The channel popup is intentionally brief: it is a reminder, not a permanent overlay. */
const CHANNEL_INFO_MS = 1500

interface TVPlayerStageProps {
  channel: TVChannel | null
  isPremiumLocked: boolean
  isImmersive: boolean
  onToggleImmersive: () => void
  onStepChannel: (direction: 1 | -1) => void
  onTransportReady: (transport: TVTransport | null) => void
  onUpgrade: () => void
  /** Hands focus back to the channel browser from an unavailable-channel message. */
  onBackToChannels: () => void
}

/**
 * The player side of TV Mode.
 *
 * The stream itself is the existing `CustomVideoPlayer` — this only frames it, adds the few TV controls
 * a remote needs (channel up/down, play/pause, full screen) and keeps them out of the way while
 * watching. Playback state, HLS handling, retry, fallback and error recovery all stay inside the player,
 * and switching channels is a source change on the same player instance rather than a remount.
 */
export function TVPlayerStage({
  channel,
  isPremiumLocked,
  isImmersive,
  onToggleImmersive,
  onStepChannel,
  onTransportReady,
  onUpgrade,
  onBackToChannels,
}: TVPlayerStageProps) {
  const [transport, setTransport] = useState<TVTransport | null>(null)
  const idleTimerRef = useRef<number | null>(null)
  const infoTimerRef = useRef<number | null>(null)
  // The idle state belongs to the channel it was reached on, so a channel change reveals the controls
  // again without an effect having to reset state.
  const [idleChannelId, setIdleChannelId] = useState<string | null>(null)
  const channelId = channel?.id ?? null
  const isIdle = Boolean(channelId) && idleChannelId === channelId
  /**
   * The channel popup.
   *
   * It is deliberately transient: a single scoped timeout shows it and clears it again, and every new
   * reveal clears the previous timeout instead of stacking another one. Choosing the channel that is
   * already playing does not reload anything — the popup is simply revealed again.
   */
  const [isInfoVisible, setInfoVisible] = useState(false)

  // Publish the transport to the page, so the remote's play/pause key works without the page having to
  // reach into the player.
  useEffect(() => {
    onTransportReady(transport)
  }, [onTransportReady, transport])

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const clearInfoTimer = useCallback(() => {
    if (infoTimerRef.current !== null) {
      window.clearTimeout(infoTimerRef.current)
      infoTimerRef.current = null
    }
  }, [])

  const revealChannelInfo = useCallback(() => {
    setInfoVisible(true)
    clearInfoTimer()
    infoTimerRef.current = window.setTimeout(() => {
      infoTimerRef.current = null
      setInfoVisible(false)
    }, CHANNEL_INFO_MS)
  }, [clearInfoTimer])

  // The control row fades out after a short idle period and any input brings it back. One timer, only
  // while the row is actually shown, cleared on unmount so nothing keeps running after TV Mode is left.
  const wake = useCallback(() => {
    setIdleChannelId(null)
    clearIdleTimer()
    idleTimerRef.current = window.setTimeout(() => setIdleChannelId(channelId), CONTROLS_IDLE_MS)
  }, [channelId, clearIdleTimer])

  // A new channel restarts the countdown, so the viewer always sees what they just tuned to.
  useEffect(() => {
    clearIdleTimer()
    idleTimerRef.current = window.setTimeout(() => setIdleChannelId(channelId), CONTROLS_IDLE_MS)
    return clearIdleTimer
  }, [channelId, clearIdleTimer])

  /**
   * Every channel change funnels through the selected channel, so this one effect gives the popup to
   * D-pad zapping, OK/Enter, PageUp/PageDown, card clicks and the opening auto-tune alike.
   *
   * Marking the reveal as a transition keeps this low-priority visual update from delaying the player's
   * own work, and the timer is the only thing that ever hides the popup again.
   */
  useEffect(() => {
    if (!channelId) return
    startTransition(revealChannelInfo)
    return clearInfoTimer
  }, [channelId, clearInfoTimer, revealChannelInfo])

  useEffect(() => () => {
    clearIdleTimer()
    clearInfoTimer()
  }, [clearIdleTimer, clearInfoTimer])

  const poster = channel?.logo ? buildCloudinaryUrl(channel.logo, { width: 1280, height: 720, crop: 'fill' }) : undefined
  const canPlay = Boolean(channel?.streamUrl) && !isPremiumLocked

  /**
   * The player element is memoised on its real inputs only.
   *
   * Popping the channel info or letting the control row idle out are TV-shell changes, so the player
   * must not re-render (let alone remount) for them — it only reacts to a different channel's stream.
   */
  const playerElement = useMemo(() => (
    <CustomVideoPlayer
      url={channel?.streamUrl}
      streamId={channel?.id}
      presenceId={channel?.id}
      channelId={channel?.id}
      presenceType="channel"
      title={channel?.name}
      poster={poster}
      autoPlay
      globalShortcuts={false}
      onTransportReady={setTransport}
      // A failed stream is when a remote most needs the channel controls, so the row comes back the
      // moment the player reports the error instead of staying idle-hidden.
      onPlayerError={wake}
    />
  ), [channel?.id, channel?.name, channel?.streamUrl, poster, wake])

  // A tap anywhere on the player surface reveals the channel identity again, without touching any player
  // control: this handler never prevents the default or stops propagation.
  const handleStagePointerDown = useCallback(() => {
    wake()
    if (canPlay) revealChannelInfo()
  }, [canPlay, revealChannelInfo, wake])

  return (
    <section
      data-tv-zone="player"
      data-tv-item
      data-tv-key="stage"
      tabIndex={-1}
      className="tv-stage"
      aria-label="TV player"
      onPointerMove={wake}
      onPointerDown={handleStagePointerDown}
      onFocus={wake}
      onKeyDown={wake}
    >
      {canPlay && channel ? (
        <div className="tv-video">{playerElement}</div>
      ) : (
        <div className="tv-stage-message">
          {isPremiumLocked ? (
            <>
              <Lock aria-hidden="true" className="tv-stage-message-icon" />
              <h2 className="tv-stage-message-title">Premium channel</h2>
              <p className="tv-stage-message-text">
                {channel ? `${formatChannelNumber(channel.number)} ${channel.name}` : 'This channel'} is part of the premium
                line-up. Access is checked by the existing subscription rules.
              </p>
              <div className="tv-stage-message-actions">
                <button type="button" data-tv-item data-tv-key="upgrade" className="tv-primary-button" onClick={onUpgrade}>
                  View plans
                </button>
                <button type="button" data-tv-item data-tv-key="next-live" className="tv-secondary-button" onClick={() => onStepChannel(1)}>
                  Next channel
                </button>
              </div>
            </>
          ) : channel ? (
            <>
              <Loader2 aria-hidden="true" className="tv-stage-message-icon" />
              <h2 className="tv-stage-message-title">Channel unavailable</h2>
              <p className="tv-stage-message-text">
                {formatChannelNumber(channel.number)} {channel.name} has no working stream right now.
              </p>
              <div className="tv-stage-message-actions">
                <button type="button" data-tv-item data-tv-key="next-live" className="tv-primary-button" onClick={() => onStepChannel(1)}>
                  Next channel
                </button>
                <button type="button" data-tv-item data-tv-key="back-to-channels" className="tv-secondary-button" onClick={onBackToChannels}>
                  Back to channels
                </button>
              </div>
            </>
          ) : (
            <>
              <Loader2 aria-hidden="true" className="tv-stage-message-icon tv-spin" />
              <h2 className="tv-stage-message-title">Tuning in</h2>
              <p className="tv-stage-message-text">Looking for the first live channel.</p>
            </>
          )}
        </div>
      )}

      {channel && canPlay && (
        <>
          {/* The channel identity is a transient popup, not a permanent label over the video. */}
          <div
            className={cn('tv-channel-info', isInfoVisible && 'tv-channel-info-visible')}
            aria-live="polite"
            aria-hidden={!isInfoVisible}
          >
            <span className="tv-info-number">{formatChannelNumber(channel.number)}</span>
            <span className="tv-info-logo" aria-hidden="true">
              {channel.logo
                ? <img src={buildCloudinaryUrl(channel.logo, { width: 96, height: 96, crop: 'fill' })} alt="" loading="lazy" decoding="async" />
                : <span className="tv-info-logo-fallback">{channel.name.slice(0, 1).toUpperCase()}</span>}
            </span>
            <span className="tv-info-meta">
              <span className="tv-info-name">{channel.name}</span>
              <span className="tv-info-category">{channel.categoryName}</span>
            </span>
          </div>

          <div className={cn('tv-player-controls', isIdle && 'tv-hidden')}>
            <button type="button" data-tv-item data-tv-key="prev-channel" className="tv-control" onClick={() => onStepChannel(-1)} aria-label="Previous channel" title="Previous channel">
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              data-tv-item
              data-tv-key="play-pause"
              className="tv-control tv-control-primary"
              onClick={() => transport?.playPause()}
              disabled={!transport}
              aria-label={transport?.isPlaying ? 'Pause' : 'Play'}
              title={transport?.isPlaying ? 'Pause' : 'Play'}
            >
              {transport?.isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
            <button type="button" data-tv-item data-tv-key="next-channel" className="tv-control" onClick={() => onStepChannel(1)} aria-label="Next channel" title="Next channel">
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              data-tv-item
              data-tv-key="immersive"
              className="tv-control"
              onClick={onToggleImmersive}
              aria-label={isImmersive ? 'Show channel controls' : 'Hide channel controls'}
              title={isImmersive ? 'Show channel controls' : 'Hide channel controls'}
            >
              {isImmersive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
