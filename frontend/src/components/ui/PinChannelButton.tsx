import { Pin } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { selectPinnedChannelIds, togglePinnedChannel } from '../../features/pinned/pinnedChannels.slice'
import { usePerformanceProfile } from '../../hooks/usePerformanceProfile'
import { cn } from '../../lib/utils'

interface PinChannelButtonProps {
  channelId: string
  /** Used for the accessible label so screen readers announce which channel is being pinned. */
  channelName?: string
  /** Placement only: the button keeps its size, states and visibility rules everywhere. */
  className?: string
}

/**
 * Pins a channel to the front of the list it appears in, or unpins it again.
 *
 * Visibility follows the input device rather than the viewport: on a device that can hover the
 * control is revealed by hovering or focusing the channel card, while touch screens, TV browsers and
 * UA-detected smart TVs (which cannot rely on hover) always show it.
 *
 * It is a real button nested as a sibling of the card link, never inside it, and it stops the click
 * from reaching the card so pinning can never navigate.
 */
export function PinChannelButton({ channelId, channelName, className }: PinChannelButtonProps) {
  const dispatch = useAppDispatch()
  const { isSmartTV } = usePerformanceProfile()
  const isPinned = useAppSelector((state) => selectPinnedChannelIds(state).includes(channelId))
  const label = isPinned ? 'Unpin channel' : 'Pin channel'

  // The `.channel-pin` rule keeps non-hover devices permanently visible and reveals the control on
  // hover/focus elsewhere; smart TVs skip it even when their browser claims hover support.
  const hoverReveal = isSmartTV ? '' : 'channel-pin'

  return (
    <button
      type="button"
      aria-label={channelName ? `${label}: ${channelName}` : label}
      aria-pressed={isPinned}
      title={label}
      onClick={(event) => {
        // Pin toggling must never open the channel behind the control.
        event.preventDefault()
        event.stopPropagation()
        dispatch(togglePinnedChannel(channelId))
      }}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-[0_6px_18px_rgba(2,6,23,0.18)] focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none',
        isPinned
          ? 'border-(--accent)/45 bg-(--accent)/20 text-(--accent)'
          : 'border-(--border) bg-(--surface)/85 text-(--text-muted) hover:border-(--accent)/40 hover:text-(--accent)',
        hoverReveal,
        className,
      )}
    >
      <Pin
        className={cn('h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none', isPinned ? 'rotate-45 fill-current' : 'group-hover:rotate-12')}
        aria-hidden="true"
      />
    </button>
  )
}
