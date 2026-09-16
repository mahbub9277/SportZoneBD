import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search, SearchX, Swords } from 'lucide-react'
import { motion } from 'framer-motion'
import { Dialog, DialogContent } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { useDebounce } from '../../hooks/useDebounce'
import { Skeleton } from '../ui/Skeleton'
import { useGetMatchesQuery } from '../../features/matches/matches.api'
import type { Match } from '../../features/matches/matches.types'
import { useGetPublicChannelsQuery } from '../../features/admin/channels.api'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import type { Channel, ChannelCategory } from '@/shared/types'

interface CommandKMenuProps {
  isOpen: boolean
  onClose: () => void
}

type SearchResult =
  | { type: 'match'; data: Match }
  | { type: 'channel'; data: Channel }

export function CommandKMenu({ isOpen, onClose }: CommandKMenuProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const debouncedQuery = useDebounce(query, 250)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<Array<HTMLDivElement | null>>([])

  const normalizedQuery = debouncedQuery.trim()
  const shouldQueryMatches = normalizedQuery.length >= 2

  const { data: matchesData, isLoading: isLoadingMatches } = useGetMatchesQuery(
    { search: normalizedQuery, limit: 5 },
    { skip: !shouldQueryMatches },
  )

  const { data: channelsData, isLoading: isLoadingChannels } = useGetPublicChannelsQuery()

  const isLoading = isLoadingMatches || (isLoadingChannels && !channelsData)

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!normalizedQuery) return []

    const matchResults = (shouldQueryMatches ? matchesData?.items ?? [] : []).map(
      (match) => ({ type: 'match', data: match } as SearchResult),
    )

    const flattenedChannels = channelsData?.flatMap((category: ChannelCategory) => category.channels ?? []) ?? []
    const channelResults = flattenedChannels
      .filter((channel: Channel) => {
        const needle = normalizedQuery.toLowerCase()
        const haystack = `${channel.name} ${channel.description ?? ''}`.toLowerCase()
        return haystack.includes(needle)
      })
      .slice(0, 5)
      .map((channel: Channel) => ({ type: 'channel', data: channel } as SearchResult))

    return [...matchResults, ...channelResults]
  }, [channelsData, matchesData, normalizedQuery, shouldQueryMatches])

  const matches = useMemo(() => searchResults.filter((result) => result.type === 'match'), [searchResults])
  const channels = useMemo(() => searchResults.filter((result) => result.type === 'channel'), [searchResults])

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setActiveIndex(0)
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 100)
    return () => window.clearTimeout(focusTimer)
  }, [isOpen])

  useEffect(() => {
    setActiveIndex(0)
    resultsRef.current = []
  }, [normalizedQuery])

  useEffect(() => {
    if (!isOpen || searchResults.length === 0) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((prev) => (prev + 1) % searchResults.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (activeIndex >= 0 && activeIndex < searchResults.length) {
          const result = searchResults[activeIndex]
          const path = result.type === 'match' ? `/matches/${result.data.id}` : `/watch/${result.data.id}`
          handleSelect(path)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, isOpen, searchResults])

  useEffect(() => {
    resultsRef.current[activeIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [activeIndex])

  const handleSelect = (path: string) => {
    onClose()
    navigate(path)
  }

  const renderResult = (result: SearchResult, index: number) => {
    const isActive = index === activeIndex
    const path = result.type === 'match' ? `/matches/${result.data.id}` : `/watch/${result.data.id}`
    const key = result.type === 'match' ? `match-${result.data.id}` : `channel-${result.data.id}`
    const name = result.type === 'match' ? result.data.title : result.data.name

    return (
      <div
        key={key}
        ref={(element) => {
          resultsRef.current[index] = element
        }}
        onClick={() => handleSelect(path)}
        onMouseMove={() => setActiveIndex(index)}
        role="option"
        aria-selected={isActive}
        className={`flex cursor-pointer items-center justify-between rounded-xl p-3 transition-colors duration-150 ${
          isActive ? 'bg-(--surface-soft)' : 'hover:bg-white/3'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {result.type === 'match' ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--surface-soft)">
              <Swords className="h-4 w-4 text-(--text-muted)" />
            </div>
          ) : (
            <img
              src={buildCloudinaryUrl(result.data.logo, { width: 24, height: 24 })}
              alt={result.data.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          )}
          <span className="truncate font-medium text-(--text-primary)">{name}</span>
        </div>
        <CornerDownLeft className="h-4 w-4 shrink-0 text-(--text-muted)" />
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="top-[30%] max-w-2xl translate-y-[-30%] p-0 sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <div className="flex items-center border-b border-(--border) px-4">
          <Search className="h-5 w-5 text-(--text-muted)" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search matches, channels..."
            className="h-14 border-0 bg-transparent text-base focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[60vh] min-h-80 overflow-y-auto p-2 sm:p-4">
          {!normalizedQuery ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center text-(--text-muted)">
              <Search size={32} className="mb-4" />
              <p>Search live matches, TV channels, and more.</p>
            </div>
          ) : isLoading ? (
            <div className="space-y-4 p-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center text-(--text-muted)">
              <SearchX size={32} className="mb-4" />
              <p>No results found for "{normalizedQuery}"</p>
            </div>
          ) : (
            <motion.div layout className="space-y-4">
              {matches.length > 0 && (
                <div>
                  <h3 id="matches-heading" className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-(--text-muted)">
                    Matches
                  </h3>
                  <div role="listbox" aria-labelledby="matches-heading" className="space-y-1">
                    {matches.map((result, index) => renderResult(result, index))}
                  </div>
                </div>
              )}

              {channels.length > 0 && (
                <div>
                  <h3 id="channels-heading" className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-(--text-muted)">
                    Channels
                  </h3>
                  <div role="listbox" aria-labelledby="channels-heading" className="space-y-1">
                    {channels.map((result, index) => renderResult(result, index + matches.length))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
