import { Lock, Play } from 'lucide-react'
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
 * Sized to be read from a sofa rather than a desk: a big logo, a bold name and the category underneath,
 * with only a few rows visible at once so the list stays scannable with a remote. The flags column stays
 * narrow and carries the real state only — the playing marker for the tuned channel, a Live badge for the
 * channels the backend really reports as active with a stream, and a lock for premium channels.
 */
export const TVChannelCard = memo(function TVChannelCard({ channel, selected, locked, onSelect }: TVChannelCardProps) {
  const poster = channel.logo ? buildCloudinaryUrl(channel.logo, { width: 128, height: 128, crop: 'fill' }) : null
  const flagsVisible = selected || channel.isLive || locked

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
        {poster
          ? <img src={poster} alt="" loading="lazy" decoding="async" />
          : <span className="tv-channel-logo-fallback">{channel.name.slice(0, 1).toUpperCase()}</span>}
      </span>

      <span className="tv-channel-meta">
        <span className="tv-channel-name">{channel.name}</span>
        <span className="tv-channel-category">{channel.categoryName}</span>
      </span>

      {flagsVisible && (
        <span className="tv-channel-flags">
          {selected && <Play className="tv-channel-playing" aria-hidden="true" />}
          {channel.isLive && (
            <span className="tv-channel-live">
              <span className="tv-channel-live-dot" aria-hidden="true" />
              Live
            </span>
          )}
          {locked && <Lock className="tv-channel-lock" aria-hidden="true" />}
        </span>
      )}
    </button>
  )
})
