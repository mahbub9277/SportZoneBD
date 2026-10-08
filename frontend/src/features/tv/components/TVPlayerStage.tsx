import { ChevronLeft, ChevronRight, Loader2, Lock, Maximize2, Minimize2, Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CustomVideoPlayer } from '../../../components/player/CustomVideoPlayer'
import { cn } from '../../../lib/utils'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { formatChannelNumber, type TVChannel } from '../tvChannels'

export interface TVTransport {
  playPause: () => void
  isPlaying: boolean
}

/** How long the channel info and the control row stay on screen after the last interaction. */
const CONTROLS_IDLE_MS = 4000

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
  // The idle state belongs to the channel it was reached on, so a channel change reveals the controls
  // again without an effect having to reset state.
  const [idleChannelId, setIdleChannelId] = useState<string | null>(null)
  const channelId = channel?.id ?? null
  const isIdle = Boolean(channelId) && idleChannelId === channelId

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

  const poster = channel?.logo ? buildCloudinaryUrl(channel.logo, { width: 1280, height: 720, crop: 'fill' }) : undefined
  const canPlay = Boolean(channel?.streamUrl) && !isPremiumLocked

  return (
    <section
      data-tv-zone="player"
      data-tv-item
      data-tv-key="stage"
      tabIndex={-1}
      className="tv-stage"
      aria-label="TV player"
      onPointerMove={wake}
      onPointerDown={wake}
      onFocus={wake}
      onKeyDown={wake}
    >
      {canPlay && channel ? (
        <div className="tv-video">
          <CustomVideoPlayer
            url={channel.streamUrl}
            streamId={channel.id}
            presenceId={channel.id}
            channelId={channel.id}
            presenceType="channel"
            title={channel.name}
            poster={poster}
            autoPlay
            globalShortcuts={false}
            onTransportReady={setTransport}
            // A failed stream is when a remote most needs the channel controls, so the row comes back the
            // moment the player reports the error instead of staying idle-hidden.
            onPlayerError={wake}
          />
        </div>
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
          <div className={cn('tv-now-playing', isIdle && 'tv-hidden')} aria-live="polite">
            <span className="tv-now-number">{formatChannelNumber(channel.number)}</span>
            <span className="tv-now-name">{channel.name}</span>
            {channel.isLive && <span className="tv-now-live">LIVE</span>}
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
              aria-label={isImmersive ? 'Exit full screen player' : 'Full screen player'}
              title={isImmersive ? 'Exit full screen player' : 'Full screen player'}
            >
              {isImmersive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
