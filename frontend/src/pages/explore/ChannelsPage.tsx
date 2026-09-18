import { useMemo, useState } from 'react'
import type { Channel, ChannelCategory } from '../../shared/types'
import { useGetPublicChannelsQuery } from '../../features/admin/channels.api'
import { Card } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { Link } from 'react-router-dom'
import { Heart, Grid, List, Search, X } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { selectFavoriteChannelIds, toggleFavoriteChannel } from '../../features/favorites/favorites.slice'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { Input } from '../../components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/Select'
import { Switch } from '../../components/ui/Switch'
import { Button } from '../../components/ui/Button'
import { useAdvertisementGate } from '../../hooks/useAdvertisementGate'
import { useDebounce } from '../../hooks/useDebounce'

export function ChannelsPage() {
  const openChannel = useAdvertisementGate('CHANNEL')
  const { data: categories, isLoading, isError } = useGetPublicChannelsQuery()
  const favoriteChannelIds = useAppSelector(selectFavoriteChannelIds)
  const dispatch = useAppDispatch()

  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 500)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>('all')
  const [premiumOnly, setPremiumOnly] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false)

  const catList = useMemo(() => categories ?? [], [categories])

  const clearFilters = () => {
    setQuery('')
    setSelectedCategoryId('all')
    setPremiumOnly(false)
  }

  const normalizedQuery = debouncedQuery.trim().toLowerCase()
  const isSearching = query.trim() !== debouncedQuery.trim()

  const filteredCategories = useMemo(() => {
    const q = normalizedQuery.length >= 2 ? normalizedQuery : ''
    if (!catList.length) return []

    const filterChannels = (channels: Channel[] = []) =>
      channels.filter((ch) => {
        if (premiumOnly && !ch.isPremium) return false
        if (q && !(ch.name ?? '').toLowerCase().includes(q)) return false
        return true
      })

    if (selectedCategoryId === 'all') {
      return catList
        .map((c: ChannelCategory) => ({ ...c, channels: filterChannels(c.channels) }))
        .filter((c): c is ChannelCategory & { channels: Channel[] } => Boolean(c.channels?.length))
    }

    const cat = catList.find((c: ChannelCategory) => c.id === selectedCategoryId)
    if (!cat) return []
    const filtered = { ...cat, channels: filterChannels(cat.channels) }
    return filtered.channels.length > 0 ? [filtered] : []
  }, [catList, normalizedQuery, selectedCategoryId, premiumOnly])

  if (isLoading) {
    return (
      <div className="space-y-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-8 w-1/4 mb-4" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, j) => <Skeleton key={j} className="h-32 w-full" />)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return <div className="rounded-2xl border border-(--danger)/30 bg-(--danger-soft) p-4 text-center text-(--danger)">Failed to load channels.</div>
  }

  return (
    <div className="app-page space-y-3">
      <section className="app-page-section rounded-4xl border border-border bg-surface/70 p-5 shadow-[0_24px_70px_rgba(2,6,23,0.12)] sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              <TvIcon />
              Live channel guide
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">TV Channels</h1>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-stretch sm:self-auto">
            <div className="relative hidden w-full min-w-60 md:block lg:w-72">
              <ChannelSearch value={query} onChange={setQuery} />
              {isSearching && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted" role="status" aria-label="Searching">Searching...</span>}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="md:hidden"
              onClick={() => setIsMobileSearchOpen((open) => !open)}
              aria-label={isMobileSearchOpen ? 'Close channel search' : 'Open channel search'}
              aria-expanded={isMobileSearchOpen}
            >
              {isMobileSearchOpen ? <X size={18} /> : <Search size={18} />}
            </Button>
            <div className="flex rounded-full border border-border bg-surface-soft/80 p-1">
              <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="icon" className="h-9 w-9" onClick={() => setViewMode('grid')} aria-label="Grid view" aria-pressed={viewMode === 'grid'}><Grid size={16} /></Button>
              <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="icon" className="h-9 w-9" onClick={() => setViewMode('list')} aria-label="List view" aria-pressed={viewMode === 'list'}><List size={16} /></Button>
            </div>
          </div>
        </div>

        {isMobileSearchOpen && (
          <div className="relative mt-4 md:hidden">
            <ChannelSearch value={query} onChange={setQuery} autoFocus />
            {isSearching && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted" role="status" aria-label="Searching">Searching...</span>}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-5">
          <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Select value={selectedCategoryId} onValueChange={(val) => setSelectedCategoryId(val as string)}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue className="truncate">{selectedCategoryId === 'all' ? 'All Categories' : catList.find((c: ChannelCategory) => c.id === selectedCategoryId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {catList.map((c: ChannelCategory) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface-soft/70 px-3 text-sm font-medium text-text-primary">
            <Switch checked={premiumOnly} onCheckedChange={(v) => setPremiumOnly(v === true)} aria-label="Show premium channels only" />
            <span>Premium only</span>
          </label>

          {(query || selectedCategoryId !== 'all' || premiumOnly) && (
            <Button type="button" variant="ghost" className="w-full gap-2 text-text-muted hover:text-accent sm:w-auto" onClick={clearFilters}>
              <X size={16} /> Clear filters
            </Button>
          )}
          <div className="ml-auto hidden text-xs font-medium uppercase tracking-[0.18em] text-text-muted sm:block">
            {filteredCategories.reduce((total, category) => total + (category.channels?.length ?? 0), 0)} channels
          </div>
        </div>
      </section>

      {filteredCategories.length === 0 && (
        <div className="rounded-4xl border border-dashed border-border bg-surface-soft/45 px-6 py-16 text-center shadow-[0_18px_50px_rgba(2,6,23,0.1)]">
          <Search className="mx-auto h-10 w-10 text-text-muted" />
          <h2 className="mt-4 text-xl font-semibold text-text-primary">No channels found</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-muted">Try another search, choose a different category, or clear the Premium Only filter.</p>
          <Button type="button" variant="outline" className="mt-5" onClick={clearFilters}>Clear filters</Button>
        </div>
      )}

      {filteredCategories.map((category: ChannelCategory) => (
        <div
          key={category.id}
          className="space-y-4"
        >
          <div
            className="flex min-w-0 items-center gap-3"
          >
            {category.image && (
              <img src={buildCloudinaryUrl(category.image, { width: 50, height: 50, crop: 'fill' })} alt={category.name} className="h-10 w-10 rounded-xl object-cover border border-border bg-surface-soft" />
            )}
            <h2 className="truncate text-2xl font-semibold text-text-primary">{category.name}</h2>
            <span className="ml-auto shrink-0 rounded-full border border-border bg-surface-soft/70 px-2.5 py-1 text-xs font-medium text-text-muted">{category.channels?.length ?? 0}</span>
          </div>

          {viewMode === 'grid' ? (
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            >
              {(category.channels ?? []).map((channel: Channel) => (
                <div
                  key={channel.id}
                >
                  <Card className="group relative flex h-full min-h-32 flex-col items-center justify-center p-2.5 text-center transition hover:border-accent/50 sm:min-h-36 sm:p-3">
                    <Link to={`/watch/${channel.id}`} onClick={(event) => { event.preventDefault(); openChannel(`/watch/${channel.id}`, channel.isPremium === true) }} className="flex w-full min-w-0 flex-col items-center justify-center">
                      <img src={buildCloudinaryUrl(channel.logo, { width: 60, height: 60, crop: 'fill' })} alt={`${channel.name} logo`} className="mb-2 h-14 w-14 rounded-full border border-border bg-surface-soft p-1 object-contain sm:h-20 sm:w-20 transition-transform duration-200 group-hover:scale-105" />
                      <p className="line-clamp-2 text-xs font-medium leading-tight text-text-primary sm:text-sm">{channel.name}</p>
                      {channel.isPremium && <span className="mt-1.5 rounded-full bg-(--accent-soft) px-1.5 py-0.5 text-[9px] font-semibold text-(--accent)">PREMIUM</span>}
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        dispatch(toggleFavoriteChannel(channel.id))
                      }}
                      className="absolute right-2 top-2 rounded-full bg-surface-soft/80 p-1.5 text-text-muted opacity-100 transition hover:text-accent sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label={favoriteChannelIds.includes(channel.id) ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <span className="block transition-transform duration-150 hover:scale-110"><Heart size={18} className={favoriteChannelIds.includes(channel.id) ? 'fill-current text-(--danger)' : 'text-text-muted'} /></span>
                    </button>
                  </Card>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="space-y-3"
            >
              {(category.channels ?? []).map((channel: Channel) => (
                <div
                  key={channel.id}
                >
                  <Card className="flex min-w-0 flex-col gap-4 p-4 transition hover:border-accent/50 sm:flex-row sm:items-center">
                    <Link to={`/watch/${channel.id}`} onClick={(event) => { event.preventDefault(); openChannel(`/watch/${channel.id}`, channel.isPremium === true) }} className="flex min-w-0 flex-1 items-center gap-4">
                      <img src={buildCloudinaryUrl(channel.logo, { width: 120, height: 120, crop: 'fill' })} alt={`${channel.name} logo`} className="h-20 w-20 shrink-0 rounded-2xl border border-border bg-surface-soft p-1 object-contain sm:h-28 sm:w-28 transition-transform duration-200 hover:scale-105" />
                      <div className="min-w-0">
                        <p className="wrap-break-word text-lg font-semibold text-text-primary">{channel.name} {channel.isPremium && <span className="ml-1 inline-flex rounded-full bg-(--accent-soft) px-2 py-0.5 text-xs font-semibold text-(--accent)">PREMIUM</span>}</p>
                        <p className="mt-1 text-sm text-text-muted">{channel.description ?? ''}</p>
                      </div>
                    </Link>
                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                      <button
                        type="button"
                        onClick={() => dispatch(toggleFavoriteChannel(channel.id))}
                        className="text-text-muted hover:text-accent"
                        aria-label={favoriteChannelIds.includes(channel.id) ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <span className="block transition-transform duration-150 hover:scale-110"><Heart size={18} className={favoriteChannelIds.includes(channel.id) ? 'fill-current text-(--danger)' : 'text-text-muted'} /></span>
                      </button>
                      <Link to={`/watch/${channel.id}`} onClick={(event) => { event.preventDefault(); openChannel(`/watch/${channel.id}`, channel.isPremium === true) }} aria-label={`Watch ${channel.name}`}>Watch</Link>
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ChannelSearch({ value, onChange, autoFocus = false }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={17} />
      <Input autoFocus={autoFocus} placeholder="Search channels..." value={value} onChange={(event) => onChange(event.target.value)} className="pl-10" />
    </div>
  )
}

function TvIcon() {
  return <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-current text-[9px]">TV</span>
}