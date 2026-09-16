import { useMemo } from 'react'
import { Tv, X } from 'lucide-react'
import { useGetPublicChannelsByIdsQuery } from '../../../features/admin/channels.api'
import type { Channel } from '../../../shared/types'
import { useAppDispatch } from '../../../app/hooks'
import { clearFavoriteChannels } from '../../../features/favorites/favorites.slice'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
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
    <div className="mt-2 rounded-3xl border border-(--border) bg-(--surface-soft)/80 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.10)] sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
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
        <p className="px-1 py-2 text-xs text-(--text-muted)">Loading favorite channels...</p>
      ) : favoriteChannels.length === 0 ? (
        <p className="px-1 py-2 text-xs text-(--text-muted)">No favorite channels yet. Add some from the Channels page!</p>
      ) : (
        <div className="grid gap-2">
          {favoriteChannels.map((channel: Channel, index: number) => (
            <button type="button" key={channel.id || `favorite-channel-${index}`} onClick={() => openChannel(`/watch/${channel.id}`, channel.isPremium === true)} className="flex min-h-14 min-w-0 items-center justify-between rounded-2xl border border-(--border) bg-(--surface)/70 px-4 py-3 text-left transition hover:border-(--accent)/40 hover:bg-(--surface-soft)">
              <span className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-(--text-primary)">{channel.name}</p></span>
              <img src={buildCloudinaryUrl(channel.logo, { width: 24, height: 24, crop: 'fill' })} alt={channel.name} className="ml-2 h-6 w-6 shrink-0 rounded-full object-contain p-0.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}