import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { selectTeamLogo, teamInitials } from '../../utils/teamLogo'
import type { Channel, ChannelCategory } from '@/shared/types'

interface CommandKMenuProps {
  isOpen: boolean
  onClose: () => void
}

type SearchResult =
  | { type: 'match'; data: Match }
  | { type: 'channel'; data: Channel }

const TEAM_LOGO_TRANSFORM = { width: 48, height: 48, crop: 'fit' as const, quality: 'auto' as const, format: 'auto' as const }

function MatchSearchCrests({ match }: { match: Match }) {
  const [failedLogos, setFailedLogos] = useState<Record<'home' | 'away', boolean>>({ home: false, away: false })
  const teams = [
    {
      side: 'home' as const,
      name: match.homeTeamName ?? match.homeTeam?.name ?? '',
      logo: selectTeamLogo([match.homeTeam?.logoUrl, match.homeTeamLogo], TEAM_LOGO_TRANSFORM).url,
    },
    {
      side: 'away' as const,
      name: match.awayTeamName ?? match.awayTeam?.name ?? '',
      logo: selectTeamLogo([match.awayTeam?.logoUrl, match.awayTeamLogo], TEAM_LOGO_TRANSFORM).url,
    },
  ].filter((team) => Boolean(team.name.trim() || team.logo))

  if (teams.length === 0) {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-(--surface-soft)" aria-hidden="true">
        <Swords className="h-4 w-4 text-(--text-muted)" />
      </span>
    )
  }

  return (
    <span className="flex shrink-0 items-center -space-x-2" aria-hidden="true">
      {teams.map(({ side, name, logo }) => (
        <span key={side} className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-(--border) bg-(--surface-soft) text-[9px] font-bold text-(--text-muted) ring-2 ring-(--surface)">
          {logo && !failedLogos[side] ? (
            <img
              src={logo}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-contain p-0.5"
              onError={() => setFailedLogos((current) => ({ ...current, [side]: true }))}
            />
          ) : (
            teamInitials(name, { fallback: side === 'home' ? 'H' : 'A' })
          )}
        </span>
      ))}
    </span>
  )
}

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

  const handleSelect = useCallback((path: string) => {
    onClose()
    navigate(path)
  }, [navigate, onClose])

  useEffect(() => {
    if (!isOpen) return
    startTransition(() => {
      setQuery('')
      setActiveIndex(0)
    })
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 100)
    return () => window.clearTimeout(focusTimer)
  }, [isOpen])

  useEffect(() => {
    startTransition(() => setActiveIndex(0))
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
  }, [activeIndex, handleSelect, isOpen, searchResults])

  useEffect(() => {
    resultsRef.current[activeIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [activeIndex])

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
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {result.type === 'match' ? (
            <MatchSearchCrests match={result.data} />
          ) : (
            <img
              src={buildCloudinaryUrl(result.data.logo, { width: 24, height: 24 })}
              alt={result.data.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium text-(--text-primary)">{name}</span>
            {result.type === 'match' && result.data.tournamentName && (
              <span className="block truncate text-xs text-(--text-muted)">{result.data.tournamentName}</span>
            )}
          </span>
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
              <p>No results found for &quot;{normalizedQuery}&quot;</p>
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
