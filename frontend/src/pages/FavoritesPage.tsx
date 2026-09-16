import { useAppSelector } from '../app/hooks'
import { useGetMatchesQuery } from '../features/matches/matches.api'
import { selectFavoriteChannelIds, selectFavoriteMatchIds } from '../features/favorites/favorites.slice'
import { FavoriteMatches } from '../components/shared/sidebar/FavoriteMatches'
import { FavoriteChannels } from '../components/shared/sidebar/FavoriteChannels'
import { Heart, Loader2, RefreshCw, Tv, Trophy } from 'lucide-react'
import { Button } from '../components/ui/Button'

export function FavoritesPage() {
  const favoriteMatchIds = useAppSelector(selectFavoriteMatchIds)
  const favoriteChannelIds = useAppSelector(selectFavoriteChannelIds)
  const matchesQuery = useGetMatchesQuery({ page: 1, limit: 100, sort: 'date-asc' }, { refetchOnMountOrArgChange: true })
  const matches = matchesQuery.data?.items ?? []

  return (
    <div className="app-page w-full min-w-0 space-y-3 px-4 pb-8 sm:px-6 lg:space-y-3 lg:px-8">
      <header className="overflow-hidden rounded-3xl border border-border bg-[linear-gradient(135deg,rgba(255,210,79,0.16),rgba(15,23,42,0.72)_62%,rgba(34,197,94,0.10))] p-5 shadow-soft sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-accent/25 bg-accent/10 p-3 text-accent shadow-sm">
            <Heart className="h-6 w-6 fill-current" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Your personal watchlist</p>
            <h1 className="mt-1 text-3xl font-semibold text-text-primary sm:text-4xl">Favorites</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">Keep the matches and TV channels you care about close, ready for the next kickoff or live stream.</p>
          </div>
        </div>
          <Button type="button" variant="outline" onClick={() => void matchesQuery.refetch()} disabled={matchesQuery.isFetching} className="w-full gap-2 sm:w-auto">
            <RefreshCw className={matchesQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh
          </Button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:max-w-lg">
          <div className="rounded-2xl border border-border/70 bg-surface/60 p-4">
            <div className="flex items-center gap-2 text-accent"><Trophy className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Matches</span></div>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{favoriteMatchIds.length}</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-surface/60 p-4">
            <div className="flex items-center gap-2 text-accent"><Tv className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Channels</span></div>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{favoriteChannelIds.length}</p>
          </div>
        </div>
      </header>

      {matchesQuery.isLoading ? (
        <div className="flex items-center justify-center rounded-3xl border border-border bg-surface-soft/60 p-8 text-sm text-text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading favorite matches...
        </div>
      ) : matchesQuery.isError ? (
        <div className="rounded-3xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-400">
          Favorite matches could not be loaded right now. Please refresh and try again.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section className="min-w-0 space-y-3">
          <div>
            <h2 className="text-xl font-semibold text-text-primary sm:text-2xl">Saved matches</h2>
            <p className="mt-1 text-sm text-text-muted">Jump straight into your saved fixtures.</p>
          </div>
          <FavoriteMatches matches={matches} favoriteIds={favoriteMatchIds} limit={100} />
        </section>
        <section className="min-w-0 space-y-3">
          <div>
            <h2 className="text-xl font-semibold text-text-primary sm:text-2xl">Saved channels</h2>
            <p className="mt-1 text-sm text-text-muted">Your preferred live TV channels, ready to watch.</p>
          </div>
        <FavoriteChannels favoriteChannelIds={favoriteChannelIds} />
        </section>
      </div>
    </div>
  )
}
