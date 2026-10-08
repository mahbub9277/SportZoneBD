import { ArrowLeft, Loader2, LogOut, RefreshCw, Search } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'
import type { TVCategory, TVChannel } from '../tvChannels'
import { TVChannelCard } from './TVChannelCard'

interface TVChannelPanelProps {
  categories: TVCategory[]
  channels: TVChannel[]
  channelsByCategory: TVChannel[]
  isLoading: boolean
  isRefreshing: boolean
  selectedChannelId: string | null
  activeCategoryId: string
  query: string
  isPremiumSubscriber: boolean
  /** Hides the panel and hands the whole viewport to the player, staying inside TV Mode. */
  onEnterPlayerView: () => void
  /** Leaves TV Mode altogether. */
  onExit: () => void
  onRefresh: () => void
  onSelectCategory: (categoryId: string) => void
  onQueryChange: (query: string) => void
  onSelectChannel: (channel: TVChannel) => void
}

/**
 * The TV control panel: everything the viewer navigates is on this side, and the player keeps the rest.
 *
 * It owns no player state at all — refreshing, filtering and searching here can never restart playback.
 * The top bar separates the two ways out of the experience: Back collapses the panel into the player
 * view and stays in TV Mode, while Exit leaves the route entirely.
 */
export const TVChannelPanel = memo(function TVChannelPanel({
  categories,
  channels,
  channelsByCategory,
  isLoading,
  isRefreshing,
  selectedChannelId,
  activeCategoryId,
  query,
  isPremiumSubscriber,
  onEnterPlayerView,
  onExit,
  onRefresh,
  onSelectCategory,
  onQueryChange,
  onSelectChannel,
}: TVChannelPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [isSearchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Opening search is a mode change, not a new screen: the input takes focus immediately so a remote
  // can type straight away, and the list below stays exactly where it was.
  useEffect(() => {
    if (isSearchOpen) searchRef.current?.focus()
  }, [isSearchOpen])

  // A filter or a refresh can replace the whole list; scroll back to the top only when the browsing
  // context really changed, never while zapping through channels in the same list.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [activeCategoryId, query])

  return (
    <aside data-tv-zone="panel" className="tv-panel" aria-label="TV channel controls">
      <div data-tv-zone="toolbar" className="tv-toolbar">
        <button
          type="button"
          data-tv-item
          data-tv-key="back"
          className="tv-icon-button"
          onClick={onEnterPlayerView}
          aria-label="Hide channel controls and show the player"
          title="Hide channel controls"
        >
          <ArrowLeft aria-hidden="true" />
          <span className="tv-button-label">Back</span>
        </button>

        <h1 className="tv-panel-title">Channels</h1>

        <button
          type="button"
          data-tv-item
          data-tv-key="search"
          className="tv-icon-button"
          onClick={() => setSearchOpen((open) => !open)}
          aria-label={isSearchOpen ? 'Close search' : 'Search channels'}
          aria-expanded={isSearchOpen}
          title="Search channels"
        >
          <Search aria-hidden="true" />
        </button>

        <button
          type="button"
          data-tv-item
          data-tv-key="refresh"
          className="tv-icon-button"
          onClick={onRefresh}
          aria-label="Refresh channels"
          title="Refresh channels"
          disabled={isRefreshing}
        >
          {isRefreshing ? <Loader2 className="tv-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        </button>

        <button
          type="button"
          data-tv-item
          data-tv-key="exit"
          className="tv-icon-button tv-icon-button-exit"
          onClick={onExit}
          aria-label="Exit TV Mode"
          title="Exit TV Mode"
        >
          <LogOut aria-hidden="true" />
        </button>
      </div>

      {isSearchOpen && (
        <div className="tv-search">
          <input
            ref={searchRef}
            data-tv-item
            data-tv-key="search-input"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            // Escape clears the query first and only then leaves the field: a remote has no other quick
            // way to empty the box.
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                onQueryChange('')
              }
            }}
            placeholder="Channel name or number"
            aria-label="Search channels by name or number"
            className="tv-search-input"
          />
        </div>
      )}

      <div data-tv-zone="categories" className="tv-categories-zone" role="group" aria-label="Channel categories">
        <span className="tv-categories-label">Categories</span>
        <div className="tv-categories">
          {categories.map((category) => {
            const isActive = category.id === activeCategoryId
            return (
              <button
                key={category.id}
                type="button"
                data-tv-item
                data-tv-key={`category:${category.id}`}
                data-tv-selected={isActive}
                aria-pressed={isActive}
                onClick={() => onSelectCategory(category.id)}
                className={cn('tv-category', isActive && 'tv-category-active')}
              >
                {category.name}
                <span className="tv-category-count">{category.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div ref={listRef} data-tv-zone="channels" className="tv-channel-list" aria-label="Channels" role="list">
        {isLoading && (
          <div className="tv-channel-skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((row) => <span key={row} className="tv-channel-skeleton-row" />)}
          </div>
        )}

        {!isLoading && channels.length === 0 && (
          <p className="tv-empty">
            {channelsByCategory.length === 0 ? 'No channels in this category.' : 'No channel matches your search.'}
          </p>
        )}

        {channels.map((channel) => (
          <TVChannelCard
            key={channel.id}
            channel={channel}
            selected={channel.id === selectedChannelId}
            locked={channel.isPremium && !isPremiumSubscriber}
            onSelect={onSelectChannel}
          />
        ))}
      </div>
    </aside>
  )
})
