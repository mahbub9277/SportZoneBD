import { useAppSelector } from '../app/hooks'
import { selectFavoriteChannelIds } from '../features/favorites/favorites.slice'
import { FavoriteChannels } from '../components/shared/sidebar/FavoriteChannels'
import { Heart, Tv } from 'lucide-react'

export function FavoritesPage() {
  const favoriteChannelIds = useAppSelector(selectFavoriteChannelIds)

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
            <p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">Keep the live TV channels you care about close, ready for the next kickoff or live stream.</p>
          </div>
        </div>
          <div className="rounded-2xl border border-border/70 bg-surface/60 p-4 sm:min-w-48">
            <div className="flex items-center gap-2 text-accent"><Tv className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Channels</span></div>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{favoriteChannelIds.length}</p>
          </div>
        </div>
      </header>

      <section className="min-w-0 space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-text-primary sm:text-2xl">Saved channels</h2>
          <p className="mt-1 text-sm text-text-muted">Your preferred live TV channels, ready to watch.</p>
        </div>
        <FavoriteChannels favoriteChannelIds={favoriteChannelIds} />
      </section>
    </div>
  )
}
