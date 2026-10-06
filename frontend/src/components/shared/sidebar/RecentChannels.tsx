import { useMemo } from 'react'
import { History, X } from 'lucide-react'
import { useGetPublicChannelsByIdsQuery } from '../../../features/admin/channels.api'
import type { Channel } from '../../../shared/types'
import { useAppDispatch } from '../../../app/hooks'
import { clearRecentChannels } from '../../../features/recent/recent.slice'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { useAdvertisementGate } from '../../../hooks/useAdvertisementGate'
import { Skeleton } from '../../ui/Skeleton'

interface RecentChannelsProps {
  recentChannelIds: string[]
  /**
   * Keeps the list geometry reserved while channel details load. Opt-in so hosts that rely on the
   * list appearing (or not) keep their current behaviour; the placeholder rows match the real rows
   * exactly, so the surrounding card cannot grow and push content below it.
   */
  showLoadingPlaceholder?: boolean
}

export function RecentChannels({ recentChannelIds, showLoadingPlaceholder = false }: RecentChannelsProps) {
  const openChannel = useAdvertisementGate('CHANNEL')
  const dispatch = useAppDispatch()

  // Fetch details for recent channels using the existing endpoint
  const { data: channelsData, isLoading } = useGetPublicChannelsByIdsQuery(recentChannelIds, {
    skip: recentChannelIds.length === 0,
  })

  const recentChannels = useMemo(() => {
    if (isLoading || !channelsData) return []
    // Ensure the order of displayed channels matches the order in recentChannelIds
    const channelMap = new Map(channelsData.map((channel: Channel) => [channel.id, channel]))
    return recentChannelIds.map((id) => channelMap.get(id)).filter(Boolean) as Channel[]
  }, [recentChannelIds, channelsData, isLoading])

  const showPlaceholders = showLoadingPlaceholder && isLoading && recentChannelIds.length > 0

  if (recentChannelIds.length === 0) {
    return null // Don't render anything if there are no recent channels
  }

  return (
    <div className="mt-2 rounded-[1.4rem] border border-(--border) bg-(--surface-soft)/80 p-3 shadow-[0_18px_60px_rgba(2,6,23,0.14)]">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
          <History className="h-4 w-4 text-(--accent)" />
          Recently Watched
        </div>
        <button
          onClick={() => dispatch(clearRecentChannels())}
          className="text-(--text-muted) transition-colors hover:text-(--accent)"
          aria-label="Clear recently watched channels"
        >
          <X size={14} />
        </button>
      </div>
      <div className="grid gap-2">
        {showPlaceholders
          ? recentChannelIds.map((id) => <RecentChannelRowPlaceholder key={`recent-placeholder-${id}`} />)
          : recentChannels.map((channel: Channel, index: number) => (
          <button
            key={channel.id || `recent-channel-${index}`}
            onClick={() => openChannel(`/watch/${channel.id}`, channel.isPremium === true)}
            className="flex items-center justify-between rounded-2xl border border-(--border) bg-(--surface)/70 px-3 py-2.5 text-left transition hover:border-(--accent)/40 hover:bg-(--surface-soft)"
          >
            <span className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-(--text-primary)">{channel.name}</p>
            </span>
            <img
              src={buildCloudinaryUrl(channel.logo, { width: 24, height: 24, crop: 'fill' })}
              alt={channel.name}
              className="ml-2 h-6 w-6 rounded-full object-cover ring-1 ring-white/10"
            />
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Mirrors a real recent-channel row box exactly (same wrapper classes and inner line/avatar sizes)
 * so the list keeps its height while channel details are still loading.
 */
function RecentChannelRowPlaceholder() {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-(--border) bg-(--surface)/70 px-3 py-2.5" aria-hidden="true">
      <span className="min-w-0 flex-1">
        <Skeleton className="h-5 w-32" />
      </span>
      <Skeleton className="ml-2 h-6 w-6 rounded-full" />
    </div>
  )
}