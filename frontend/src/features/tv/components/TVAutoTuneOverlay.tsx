import { useCallback, useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { cn } from '../../../lib/utils'
import { formatChannelNumber, type TVChannel } from '../tvChannels'
import type { AutoTuneStatus } from '../useAutoTune'

interface TVAutoTuneOverlayProps {
  status: Exclude<AutoTuneStatus, 'idle'>
  scanned: number
  total: number
  /** The catalogue entry being validated, shown while the scan runs. */
  currentChannel: TVChannel | null
  found: TVChannel[]
  /** Stops the scan: nothing keeps running behind the overlay. */
  onCancel: () => void
  /** Starts a fresh scan from the empty and failed states. */
  onRetry: () => void
  /** Accepts the result through the page's existing channel-selection path. */
  onStartWatching: () => void
  onClose: () => void
}

/** Enough of a result to be useful from a sofa: the rest is what the channel panel is for. */
const MAX_RESULT_ROWS = 6

interface AutoTuneAction {
  key: string
  label: string
  onClick: () => void
  primary?: boolean
}

/**
 * The Auto Tune overlay.
 *
 * It is an overlay of TV Mode, not a route: the player, the channel panel and the selected channel all
 * stay exactly as they were, and the overlay owns the keyboard while it is open. Every key it handles
 * stops propagating, so no arrow, channel or number key can reach the shell and zap something behind it.
 */
export function TVAutoTuneOverlay({
  status,
  scanned,
  total,
  currentChannel,
  found,
  onCancel,
  onRetry,
  onStartWatching,
  onClose,
}: TVAutoTuneOverlayProps) {
  const titleId = useId()
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([])

  const isScanning = status === 'scanning'
  const actions: AutoTuneAction[] = isScanning
    ? [{ key: 'cancel', label: 'Cancel', onClick: onCancel }]
    : status === 'completed'
      ? [
          { key: 'start', label: 'Start watching', onClick: onStartWatching, primary: true },
          { key: 'close', label: 'Close', onClick: onClose },
        ]
      : [
          { key: 'retry', label: 'Retry', onClick: onRetry, primary: true },
          { key: 'close', label: 'Close', onClick: onClose },
        ]

  const focusAction = useCallback((index: number) => {
    actionRefs.current[index]?.focus({ preventScroll: true })
  }, [])

  // The overlay takes focus as it opens, and moves it to the leading action of whatever state the scan
  // has reached — during a scan that is the cancel, afterwards it is the way to start watching.
  useEffect(() => {
    focusAction(0)
  }, [focusAction, status])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement
    const index = actionRefs.current.findIndex((action) => action === active)
    const lastIndex = actions.length - 1

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        // Escape follows the state: it stops the scan, and closes the overlay once there is nothing left
        // to stop.
        if (isScanning) onCancel()
        else onClose()
        break
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        if (lastIndex > 0) focusAction(index < 0 ? 0 : Math.min(lastIndex, index + 1))
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        if (lastIndex > 0) focusAction(index < 0 ? 0 : Math.max(0, index - 1))
        break
      case 'Tab':
        // Focus never leaves the overlay while it is open.
        event.preventDefault()
        if (lastIndex > 0) {
          const step = event.shiftKey ? -1 : 1
          focusAction(index < 0 ? 0 : (index + step + actions.length) % actions.length)
        }
        break
      default:
        break
    }

    event.stopPropagation()
  }, [actions.length, focusAction, isScanning, onCancel, onClose])

  const progress = total > 0 ? Math.min(1, scanned / total) : 1
  const results = found.slice(0, MAX_RESULT_ROWS)
  const remaining = found.length - results.length

  return (
    <div className="tv-autotune-scrim" onKeyDown={handleKeyDown}>
      <div className="tv-autotune" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="tv-autotune-header">
          <h2 className="tv-autotune-title" id={titleId}>
            {isScanning && 'Auto Tune'}
            {status === 'completed' && 'Auto Tune complete'}
            {status === 'empty' && 'No channels found'}
            {status === 'error' && 'Auto Tune failed'}
          </h2>
          <p className="tv-autotune-subtitle" role={isScanning ? undefined : 'status'}>
            {isScanning && 'Scanning available channels'}
            {status === 'completed' && `${found.length} ${found.length === 1 ? 'channel' : 'channels'} found in ${total} scanned`}
            {status === 'empty' && 'Nothing in the current catalogue can be watched right now.'}
            {status === 'error' && 'Please try again.'}
          </p>
        </div>

        {isScanning && (
          <>
            <div
              className="tv-autotune-progress"
              role="progressbar"
              aria-label="Auto Tune progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={scanned}
            >
              <span className="tv-autotune-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>

            <div className="tv-autotune-stats">
              <span className="tv-autotune-count">
                Scanning channels
                <strong>{`${scanned} / ${total}`}</strong>
              </span>
              <span className="tv-autotune-current">
                {currentChannel
                  ? <>
                      <span className="tv-autotune-current-number">{formatChannelNumber(currentChannel.number)}</span>
                      <span className="tv-autotune-current-name">{currentChannel.name}</span>
                    </>
                  : 'Preparing the scan'}
              </span>
            </div>
          </>
        )}

        {status === 'completed' && found.length > 0 && (
          <ul className="tv-autotune-results" aria-label="Channels found">
            {results.map((channel) => (
              <li className="tv-autotune-result" key={channel.id}>
                <span className="tv-autotune-result-number">{formatChannelNumber(channel.number)}</span>
                <span className="tv-autotune-result-name">{channel.name}</span>
                <span className="tv-autotune-result-category">{channel.categoryName}</span>
              </li>
            ))}
            {remaining > 0 && (
              <li className="tv-autotune-more">
                {`and ${remaining} more in the channel list`}
              </li>
            )}
          </ul>
        )}

        <div className="tv-autotune-actions">
          {actions.map((action, index) => (
            <button
              key={action.key}
              ref={(element) => { actionRefs.current[index] = element }}
              type="button"
              className={cn('tv-autotune-button', action.primary && 'tv-autotune-button-primary')}
              onClick={action.onClick}
              data-autotune-action={action.key}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
