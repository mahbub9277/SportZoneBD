import { ChevronRight, Grid3x3, Lock, Loader2, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CustomVideoPlayer } from '../../../components/player/CustomVideoPlayer'
import { cn } from '../../../lib/utils'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { formatChannelNumber, type TVChannel } from '../tvChannels'
import { TVChannelKeypad } from './TVChannelKeypad'

export interface TVTransport {
  playPause: () => void
  isPlaying: boolean
}

/** How long the channel popup and the control row stay on screen after the last interaction. */
const CONTROLS_IDLE_MS = 4000

/** The channel popup is intentionally brief: it is a reminder, not a permanent overlay. */
const CHANNEL_INFO_MS = 2000

interface TVPlayerStageProps {
  channel: TVChannel | null
  isPremiumLocked: boolean
  isImmersive: boolean
  isKeypadOpen: boolean
  /**
   * Bumped whenever the viewer asks for the channel identity again — including on the channel that is
   * already playing, where no source change happens and the popup would otherwise stay hidden.
   */
  infoRequest: number
  /** A digit the remote sent while the pad was closed, so the pad can own the typed number. */
  digitRequest: { value: string; seq: number } | null
  /** Reports that the digit request has been applied, so the page can drop it. */
  onDigitRequestHandled: () => void
  onToggleImmersive: () => void
  onToggleKeypad: () => void
  onCloseKeypad: () => void
  /** Tunes to a channel the keypad resolved, through the page's existing selection path. */
  onTuneChannel: (channel: TVChannel) => void
  /** Resolves a typed channel number against the real catalogue; null when no channel holds it. */
  resolveChannelNumber: (digits: string) => TVChannel | null
  /** Reports a confirmed terminal playback failure for the channel that produced it. */
  onChannelPlaybackError: (channelId: string) => void
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
 * a remote needs (the numeric keypad, the channel-panel toggle and the slim tab that brings the panel
 * back) and keeps them out of the way while watching. Playback is driven by the remote itself
 * (play/pause and channel up/down keys), not by on-screen transport buttons. Playback state, HLS
 * handling, retry, fallback and error recovery all stay inside the player, and switching channels is a
 * source change on the same player instance rather than a remount — including the panel toggle, which
 * only changes the grid, so the player keeps playing through it.
 */
export function TVPlayerStage({
  channel,
  isPremiumLocked,
  isImmersive,
  isKeypadOpen,
  infoRequest,
  digitRequest,
  onDigitRequestHandled,
  onToggleImmersive,
  onToggleKeypad,
  onCloseKeypad,
  onTuneChannel,
  resolveChannelNumber,
  onChannelPlaybackError,
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

  /**
   * A viewer asking for the channel again — tuning to the number that is already playing, or tapping the
   * player after the popup has faded — gets the popup back with nothing reloaded. Only a real bump of the
   * request counts, so this never fires as a duplicate of the channel change above.
   */
  const lastInfoRequestRef = useRef(infoRequest)
  useEffect(() => {
    if (infoRequest === lastInfoRequestRef.current) return
    lastInfoRequestRef.current = infoRequest
    startTransition(revealChannelInfo)
  }, [infoRequest, revealChannelInfo])

  useEffect(() => () => {
    clearIdleTimer()
    clearInfoTimer()
  }, [clearIdleTimer, clearInfoTimer])

  const poster = channel?.logo ? buildCloudinaryUrl(channel.logo, { width: 1280, height: 720, crop: 'fill' }) : undefined
  const canPlay = Boolean(channel?.streamUrl) && !isPremiumLocked
  /**
   * A channel the catalogue itself says cannot play: it carries no stream url at all. That is a confirmed
   * no-signal condition, unlike anything the player reports while it is loading or buffering, and it is
   * the same condition the "Channel unavailable" message describes.
   */
  const isNoSignal = Boolean(channel) && !isPremiumLocked && !channel?.streamUrl

  const handlePlayerError = useCallback(() => {
    // A failed stream is when a remote most needs the channel controls, so the row comes back the moment
    // the player reports the error — and the failure is reported together with the channel that produced
    // it, so a late report can never move the viewer away from a channel they have since chosen.
    wake()
    if (channelId) onChannelPlaybackError(channelId)
  }, [channelId, onChannelPlaybackError, wake])

  /**
   * The player element is memoised on its real inputs only.
   *
   * Popping the channel info or letting the control row idle out are TV-shell changes, so the player
   * must not re-render (let alone remount) for them — it only reacts to a different channel's stream.
   */
  const playerElement = useMemo(() => (
    <CustomVideoPlayer
      url={channel?.streamUrl}
      /**
       * Only `channelId` is passed: a channel is not a `stream` record, and the proxy resolves
       * `streamId` against the stream table (a channel id there is a guaranteed 404, which the player
       * used to spend two failed requests on before falling back to the direct URL anyway). Channel
       * playback therefore plays the channel's stored URL directly, exactly like the normal channel
       * page, while the channel identity is still available for premium checks and telemetry.
       */
      presenceId={channel?.id}
      channelId={channel?.id}
      presenceType="channel"
      title={channel?.name}
      poster={poster}
      autoPlay
      globalShortcuts={false}
      onTransportReady={setTransport}
      onPlayerError={handlePlayerError}
    />
  ), [channel?.id, channel?.name, channel?.streamUrl, handlePlayerError, poster])

  // A tap anywhere on the player surface reveals the channel identity again, without touching any player
  // control: this handler never prevents the default or stops propagation. Taps on TV Mode's own buttons
  // are excluded — the keypad is the viewer answering that popup, and the control rows are not the video.
  const handleStagePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    wake()
    const target = event.target
    const onTvControl = target instanceof HTMLElement
      && Boolean(target.closest('.tv-keypad, .tv-stage-controls, .tv-panel-tab'))
    if (canPlay && !onTvControl) revealChannelInfo()
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
        <>
          {/* A confirmed no-signal channel gets the restrained static treatment behind its message. It
              never appears while the player is loading or buffering, and it never covers the message or
              the recovery buttons, which stay the actionable layer. */}
          {isNoSignal && (
            <div className="tv-no-signal" aria-hidden="true">
              <span className="tv-no-signal__effect" />
              <span className="tv-no-signal__scanlines" />
            </div>
          )}
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
        </>
      )}

      {/* The stage's own status, at the opposite corner from the controls: the real live state of the
          channel that is playing. It never claims more than the catalogue knows. */}
      {channel && canPlay && channel.isLive && (
        <p className={cn('tv-stage-status', isIdle && 'tv-hidden')} aria-live="polite">
          <span className="tv-stage-status-dot" aria-hidden="true" />
          Live
        </p>
      )}

      {/* Always reachable, whatever the stage is showing: hiding the panel and tuning by number are not
          playback actions, and a channel that will not play is exactly when a viewer needs them. It sits
          before the keypad in the document so one arrow press from the player surface reaches it. */}
      <div className={cn('tv-stage-controls', isIdle && 'tv-hidden')}>
        <button
          type="button"
          data-tv-item
          data-tv-key="keypad"
          className={cn('tv-control', isKeypadOpen && 'tv-control-active')}
          onClick={onToggleKeypad}
          aria-label={isKeypadOpen ? 'Close the channel number keypad' : 'Open the channel number keypad'}
          aria-expanded={isKeypadOpen}
          title="Channel number keypad"
        >
          <Grid3x3 aria-hidden="true" />
        </button>
        <button
          type="button"
          data-tv-item
          data-tv-key="panel-visibility"
          className="tv-control"
          onClick={onToggleImmersive}
          aria-label={isImmersive ? 'Show channel panel' : 'Hide channel panel'}
          title={isImmersive ? 'Show channel panel' : 'Hide channel panel'}
        >
          {isImmersive ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>

      {/* The collapsed panel leaves this tab behind: pinned to the far left, a little below the top of
          the viewport, and never hidden with the control rows, so the panel can always be brought back
          with a pointer or a remote. */}
      {isImmersive && (
        <button
          type="button"
          data-tv-item
          data-tv-key="panel-tab"
          className="tv-panel-tab"
          onClick={onToggleImmersive}
          aria-label="Show channel panel"
          title="Show channel panel"
        >
          <ChevronRight aria-hidden="true" />
          <span className="tv-panel-tab-label">Channels</span>
        </button>
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
        </>
      )}

      {/* The keypad is an overlay of the same stage, so opening it never touches the player. A digit the
          remote sent from elsewhere in the shell is forwarded to it, so the pad stays the only owner of
          the entered number. */}
      {isKeypadOpen && (
        <TVChannelKeypad
          resolveChannelNumber={resolveChannelNumber}
          onTune={onTuneChannel}
          onClose={onCloseKeypad}
          digitRequest={digitRequest}
          onDigitRequestHandled={onDigitRequestHandled}
        />
      )}
    </section>
  )
}
