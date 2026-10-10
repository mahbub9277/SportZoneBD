import { ArrowLeft, ChevronDown, Loader2, LogOut, Radar, RefreshCw, Search } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../../lib/utils'
import type { TVCategory, TVChannel } from '../tvChannels'
import type { AutoTuneStatus } from '../useAutoTune'
import { TVChannelCard } from './TVChannelCard'

/**
 * PageUp/PageDown are what a media remote sends for CH+/CH−. An open category menu owns them like the
 * arrows, so they are translated instead of reaching the shell and zapping a channel behind the menu.
 */
const MENU_KEY_ALIASES: Record<string, string> = { PageUp: 'ArrowUp', PageDown: 'ArrowDown' }

const isMenuStepKey = (key: string): boolean =>
  key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End' || key in MENU_KEY_ALIASES

const toMenuKey = (key: string): string => MENU_KEY_ALIASES[key] ?? key

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
  /** Auto Tune's state, so the control can report a running scan: the scan itself lives on the page. */
  autoTuneStatus: AutoTuneStatus
  /** The channel the player reports as really playing, so the card marker is never guessed. */
  playingChannelId: string | null
  /** Hides the panel and hands the whole viewport to the player, staying inside TV Mode. */
  onEnterPlayerView: () => void
  /** Leaves TV Mode altogether. */
  onExit: () => void
  onRefresh: () => void
  /** Starts the existing Auto Tune scan. */
  onStartAutoTune: () => void
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
  autoTuneStatus,
  playingChannelId,
  onEnterPlayerView,
  onExit,
  onRefresh,
  onStartAutoTune,
  onSelectCategory,
  onQueryChange,
  onSelectChannel,
}: TVChannelPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [isSearchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [isCategoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const categoryTriggerRef = useRef<HTMLButtonElement | null>(null)
  const categoryMenuRef = useRef<HTMLDivElement | null>(null)

  const activeCategory = categories.find((category) => category.id === activeCategoryId) ?? null

  const categoryOptions = useCallback(() => {
    const menu = categoryMenuRef.current
    return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('[data-tv-item]')) : []
  }, [])

  /** Moves DOM focus between the menu options so a remote's arrows and Enter work without any extra state. */
  const moveCategoryFocus = useCallback((key: string) => {
    const options = categoryOptions()
    if (options.length === 0) return
    const activeIndex = options.indexOf(document.activeElement as HTMLButtonElement)
    const index = key === 'Home'
      ? 0
      : key === 'End'
        ? options.length - 1
        : (activeIndex === -1 ? 0 : (activeIndex + (key === 'ArrowUp' ? -1 : 1) + options.length) % options.length)
    options[index]?.focus({ preventScroll: true })
  }, [categoryOptions])

  /** Opens the menu from the trigger and puts focus straight on the current category. */
  const focusCategoryOption = useCallback((step: 1 | -1) => {
    const options = categoryOptions()
    if (options.length === 0) return
    const selected = options.find((option) => option.getAttribute('data-tv-selected') === 'true')
    const from = step === -1 ? options.length - 1 : 0
    ;(selected ?? options[from]).focus({ preventScroll: true })
  }, [categoryOptions])

  const commitCategory = useCallback((categoryId: string) => {
    setCategoryMenuOpen(false)
    onSelectCategory(categoryId)
    categoryTriggerRef.current?.focus()
  }, [onSelectCategory])

  /** Collapsing the panel must not leave an open menu behind for the next time the panel is restored. */
  const handleEnterPlayerView = useCallback(() => {
    setCategoryMenuOpen(false)
    onEnterPlayerView()
  }, [onEnterPlayerView])

  // Opening the menu is a mode change: focus lands on the current category immediately so the first
  // arrow key already works, and the list below is left untouched.
  useEffect(() => {
    if (isCategoryMenuOpen) focusCategoryOption(1)
  }, [isCategoryMenuOpen, focusCategoryOption])

  // A click anywhere else closes the menu without changing the tuned channel.
  useEffect(() => {
    if (!isCategoryMenuOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (categoryTriggerRef.current?.contains(event.target as Node)) return
      if (categoryMenuRef.current?.contains(event.target as Node)) return
      setCategoryMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isCategoryMenuOpen])

  // The category control is the only filter, so a filter committed anywhere else (a restored session, a
  // fresh catalogue) always leaves the menu closed rather than open on a stale list.
  useEffect(() => {
    setCategoryMenuOpen(false)
  }, [activeCategoryId])

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
          onClick={handleEnterPlayerView}
          aria-label="Hide channel panel and show the player"
          title="Hide channel panel"
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
        <span className="tv-categories-label" id="tv-category-label">Category</span>
        <div className="tv-category-row">
          <div className="tv-category-select">
            <button
              type="button"
              data-tv-item
              data-tv-key="category-select"
              ref={categoryTriggerRef}
              className="tv-category-trigger"
              aria-haspopup="listbox"
              aria-expanded={isCategoryMenuOpen}
              aria-labelledby="tv-category-label"
              onClick={() => setCategoryMenuOpen((open) => !open)}
              // While the menu is open the arrows and the channel page keys belong to the menu, so they
              // must not also zap the list below or pull focus out of the dropdown.
              onKeyDown={(event) => {
                if (!isCategoryMenuOpen) return
                if (isMenuStepKey(event.key) || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  focusCategoryOption(event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setCategoryMenuOpen(false)
                }
              }}
            >
              <span className="tv-category-trigger-name">{activeCategory?.name ?? 'All channels'}</span>
              <span className="tv-category-trigger-count" aria-hidden="true">{activeCategory?.count ?? channelsByCategory.length}</span>
              <ChevronDown aria-hidden="true" />
            </button>

            {isCategoryMenuOpen && (
              <div
                className="tv-category-menu"
                role="listbox"
                aria-labelledby="tv-category-label"
                ref={categoryMenuRef}
                onKeyDown={(event) => {
                  if (isMenuStepKey(event.key)) {
                    event.preventDefault()
                    event.stopPropagation()
                    moveCategoryFocus(toMenuKey(event.key))
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setCategoryMenuOpen(false)
                    categoryTriggerRef.current?.focus()
                  }
                }}
              >
                {categories.length === 0 && <p className="tv-category-empty">No categories available.</p>}
                {categories.map((category) => {
                  const isActive = category.id === activeCategoryId
                  return (
                    <button
                      key={category.id}
                      type="button"
                      data-tv-item
                      data-tv-key={`category:${category.id}`}
                      data-tv-selected={isActive}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => commitCategory(category.id)}
                      className="tv-category-option"
                    >
                      <span className="tv-category-option-name">{category.name}</span>
                      <span className="tv-category-option-count">{category.count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Auto Tune scans the catalogue the viewer is browsing, so it lives on the category row it
              filters. It is the same scan the page already runs — one action, one entry point. */}
          <button
            type="button"
            data-tv-item
            data-tv-key="auto-tune"
            data-state={autoTuneStatus === 'scanning' ? 'scanning' : 'idle'}
            className={cn('tv-control tv-control-labelled', autoTuneStatus === 'scanning' && 'tv-control-active')}
            onClick={onStartAutoTune}
            aria-label={autoTuneStatus === 'scanning' ? 'Auto Tune is scanning' : 'Start Auto Tune'}
            title="Scan the catalogue for channels you can watch"
          >
            <Radar aria-hidden="true" />
            <span className="tv-control-label">{autoTuneStatus === 'scanning' ? 'Scanning…' : 'Auto Tune'}</span>
          </button>
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
            playing={channel.id === playingChannelId}
            locked={channel.isPremium && !isPremiumSubscriber}
            onSelect={onSelectChannel}
          />
        ))}
      </div>
    </aside>
  )
})
