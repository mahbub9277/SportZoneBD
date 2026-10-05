import { useMemo } from 'react'
import { ArrowRight, Star, Tv, X } from 'lucide-react'
import { useGetPublicChannelsByIdsQuery } from '../../../features/admin/channels.api'
import type { Channel } from '../../../shared/types'
import { useAppDispatch } from '../../../app/hooks'
import { clearFavoriteChannels } from '../../../features/favorites/favorites.slice'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { Skeleton } from '../../ui/Skeleton'
import { useAdvertisementGate } from '../../../hooks/useAdvertisementGate'

interface FavoriteChannelsProps {
  favoriteChannelIds: string[]
}

export function FavoriteChannels({ favoriteChannelIds }: FavoriteChannelsProps) {
  const openChannel = useAdvertisementGate('CHANNEL')
  const dispatch = useAppDispatch()

  // Fetch details for favorite channels
  const { data: channelsData, isLoading } = useGetPublicChannelsByIdsQuery(favoriteChannelIds, {
    skip: favoriteChannelIds.length === 0, // Skip query if no favorite channels
  })

  const favoriteChannels = useMemo(() => {
    if (isLoading || !channelsData) return []
    // Ensure the order of displayed channels matches the order in favoriteChannelIds
    const channelMap = new Map(channelsData.map((channel: Channel) => [channel.id, channel]));
    return favoriteChannelIds.map(id => channelMap.get(id)).filter(Boolean) as Channel[];
  }, [favoriteChannelIds, channelsData, isLoading]);

  return (
    <div className="rounded-3xl border border-(--border) bg-(--surface-soft)/80 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.10)] sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
          <Tv className="h-4 w-4 text-(--accent)" />
          Favorite Channels
        </div>
        {favoriteChannelIds.length > 0 && (
          <button type="button" onClick={() => dispatch(clearFavoriteChannels())} className="text-(--text-muted) transition-colors hover:text-(--accent)" aria-label="Clear favorite channels">
            <X size={14} />
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-24 w-full rounded-2xl" />)}
        </div>
      ) : favoriteChannels.length === 0 ? (
        <p className="px-1 py-2 text-xs text-(--text-muted)">No favorite channels yet. Add some from the Channels page!</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {favoriteChannels.map((channel: Channel, index: number) => (
            <li key={channel.id || `favorite-channel-${index}`} className="min-w-0">
              <button type="button" onClick={() => openChannel(`/watch/${channel.id}`, channel.isPremium === true)} className="group flex h-full min-h-24 w-full min-w-0 items-center gap-4 rounded-2xl border border-(--border) bg-(--surface)/70 p-3 text-left transition hover:border-(--accent)/40 hover:bg-(--surface-soft) sm:p-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-border bg-surface-soft p-1 sm:h-16 sm:w-16">
                  <img src={buildCloudinaryUrl(channel.logo, { width: 128, height: 128, crop: 'fill' })} alt={`${channel.name} logo`} loading="lazy" decoding="async" className="h-full w-full object-contain" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-(--text-primary)">{channel.name}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-(--text-muted)">
                    <Star className="h-3.5 w-3.5 fill-current text-(--accent)" />
                    Saved channel
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-(--text-muted) transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-(--accent)" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}