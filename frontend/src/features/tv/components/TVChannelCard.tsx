import { memo } from 'react'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { formatChannelNumber, type TVChannel } from '../tvChannels'

interface TVChannelCardProps {
  channel: TVChannel
  selected: boolean
  locked: boolean
  onSelect: (channel: TVChannel) => void
}

/**
 * One channel row in the TV list.
 *
 * Kept to a fixed, shallow DOM: number, logo, name, live state. It is memoised because the list is the
 * only part of the screen that re-renders while a stream plays — the player must not re-render when
 * focus moves or the search box changes.
 */
export const TVChannelCard = memo(function TVChannelCard({ channel, selected, locked, onSelect }: TVChannelCardProps) {
  return (
    <button
      type="button"
      data-tv-item
      data-tv-key={`channel:${channel.id}`}
      data-tv-selected={selected}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(channel)}
      className="tv-channel-card"
    >
      <span className="tv-channel-number">{formatChannelNumber(channel.number)}</span>

      <span className="tv-channel-logo" aria-hidden="true">
        {channel.logo
          ? <img src={buildCloudinaryUrl(channel.logo, { width: 80, height: 80, crop: 'fill' })} alt="" loading="lazy" decoding="async" />
          : <span className="tv-channel-logo-fallback">{channel.name.slice(0, 1).toUpperCase()}</span>}
      </span>

      <span className="tv-channel-meta">
        <span className="tv-channel-name">{channel.name}</span>
        <span className="tv-channel-state">
          {channel.isLive
            ? <span className="tv-channel-live"><span className="tv-channel-live-dot" aria-hidden="true" />LIVE</span>
            : <span className="tv-channel-offline">Offline</span>}
          {locked && <span className="tv-channel-locked">Premium</span>}
        </span>
      </span>
    </button>
  )
})
