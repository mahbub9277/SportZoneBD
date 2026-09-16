import { useMemo } from 'react'
import { Heart, Radio, Star, X } from 'lucide-react'
import type { Match } from '../../../features/matches/matches.types'
import { useAppDispatch } from '../../../app/hooks'
import { clearFavoriteMatches } from '../../../features/favorites/favorites.slice'
import { useAdvertisementGate } from '../../../hooks/useAdvertisementGate'

interface FavoriteMatchesProps {
  matches: Match[]
  favoriteIds: string[]
  limit?: number
}

export function FavoriteMatches({ matches, favoriteIds, limit = 3 }: FavoriteMatchesProps) {
  const openMatch = useAdvertisementGate('MATCH')
  const dispatch = useAppDispatch()

  const favoriteMatches = useMemo(() => matches.filter((match: Match) => favoriteIds.includes(match.id)).slice(0, limit), [favoriteIds, limit, matches])

  return (
    <div className="rounded-3xl border border-(--border) bg-(--surface-soft)/80 p-4 shadow-[0_18px_60px_rgba(2,6,23,0.10)] sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
          <Heart className="h-4 w-4 text-(--accent)" />
          Favorites
        </div>
        {favoriteIds.length > 0 && (
          <button type="button" onClick={() => dispatch(clearFavoriteMatches())} className="text-(--text-muted) transition-colors hover:text-(--accent)" aria-label="Clear favorite matches">
            <X size={14} />
          </button>
        )}
      </div>
      {favoriteMatches.length === 0 ? <p className="px-1 py-2 text-xs text-(--text-muted)">Tap the star on a match to save it here.</p> : (
        <div className="grid gap-2">
          {favoriteMatches.map((match: Match) => (
            <button type="button" key={match.id} onClick={() => openMatch(`/matches/${match.id}`, match.premium === true)} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-(--border) bg-(--surface)/70 px-4 py-3 text-left transition hover:border-(--accent)/40 hover:bg-(--surface-soft)">
              <span className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--text-primary)">{match.title}</p>
                <span className="mt-1 flex items-center gap-1.5 text-[11px] text-(--text-muted)">
                  {match.status === 'LIVE' && <Radio className="h-3 w-3 text-red-400" />}
                  {match.status === 'LIVE' ? 'Live now' : match.status.toLowerCase()}
                </span>
              </span>
              <Star className="ml-2 h-4 w-4 shrink-0 fill-current text-(--accent)" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}