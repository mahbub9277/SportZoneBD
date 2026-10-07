import { useGetMatchesQuery, useLazyGetMatchesQuery } from '../../features/matches/matches.api'
import { MatchCardSkeleton } from '../../components/skeletons/MatchCardSkeleton'
import { Search, Star } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Checkbox } from '../../components/ui/Checkbox'
import { Label } from '../../components/ui/Label'
import { useFilterState } from '../../hooks/useFilterState'
import { cn } from '../../lib/utils'
import { MatchCardDisplay } from '../../components/MatchCardDisplay'
import type { Match } from '../../features/matches/matches.types'
import { useAdvertisementGate } from '../../hooks/useAdvertisementGate'
import { filterMatches, sortMatches } from '../../features/matches/matchOrdering'
import { getMatchCalendarWindowEnd } from '../../utils/matchDateTime'
import { useEffect, useMemo, useState, memo, useCallback } from 'react'

const matchStatuses = ['LIVE', 'UPCOMING'] as const
const RECENT_MATCH_LIMIT = 24
const emptyMatches: Match[] = []
const statusFilters = [
  { value: 'Recent', label: 'Recent' },
  { value: 'LIVE', label: 'Live' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'All', label: 'All' },
] as const

type MatchStatus = (typeof matchStatuses)[number]

type MatchOpenHandler = (destination: string, requiresPremium?: boolean) => void

/**
 * Each card owns a stable open handler so `MatchCardDisplay`'s memo actually holds. Passing an inline
 * arrow from the list (as before) created a new prop on every render, which re-rendered all match
 * cards — up to a hundred of them when the "All" filter loads every page.
 */
const MatchCardItem = memo(function MatchCardItem({ match, onOpen }: { match: Match; onOpen: MatchOpenHandler }) {
  const handleOpen = useCallback(
    () => onOpen(`/matches/${match.id}`, match.premium === true),
    [match.id, match.premium, onOpen],
  )

  return <MatchCardDisplay match={match} onOpen={handleOpen} />
})

const normalizeStatus = (status?: string) => {
  if (!status) return undefined
  const upperStatus = status.toUpperCase()
  if (upperStatus === 'ALL') return undefined
  return matchStatuses.includes(upperStatus as MatchStatus) ? (upperStatus as MatchStatus) : undefined
}

export function AllMatchesPage() {
  const openMatch = useAdvertisementGate('MATCH')

  const { filters, setFilters, debouncedFilters } = useFilterState({
    search: '',
    status: 'Recent',
    premium: false,
  }, ['search']);

  const { search, status, premium } = filters
  const normalizedStatus = normalizeStatus(status)
  const isRecent = status === 'Recent'
  const [triggerMatches] = useLazyGetMatchesQuery()
  const [allMatchesResult, setAllMatchesResult] = useState<{ key: string; items: Match[] } | null>(null)
  const [allMatchesErrorKey, setAllMatchesErrorKey] = useState<string | null>(null)
  const allQueryKey = JSON.stringify([debouncedFilters.search, premium])
  const matchQuery = useGetMatchesQuery({
    page: 1,
    limit: isRecent ? RECENT_MATCH_LIMIT : 100,
    search: debouncedFilters.search,
    premium: premium,
    ...(isRecent
      ? { recentOnly: true, status: 'FINISHED', sort: 'finishedAt:desc' }
      : normalizedStatus
        ? { status: normalizedStatus, ...(normalizedStatus === 'UPCOMING' ? { sort: 'date-asc' } : {}) }
        : {}),
  }, { skip: status === 'All' })

  useEffect(() => {
    if (status !== 'All') return
    let active = true

    const loadAllMatches = async () => {
      try {
        const queryArgs = { page: 1, limit: 100, search: debouncedFilters.search, premium }
        const firstPage = await triggerMatches(queryArgs, true).unwrap()
        const remainingPages = await Promise.all(
          Array.from({ length: Math.max(0, firstPage.meta.totalPages - 1) }, (_, index) =>
            triggerMatches({ ...queryArgs, page: index + 2 }, true).unwrap(),
          ),
        )

        if (active) {
          setAllMatchesResult({
            key: allQueryKey,
            items: [firstPage, ...remainingPages].flatMap((page) => page.items),
          })
          setAllMatchesErrorKey(null)
        }
      } catch {
        if (active) setAllMatchesErrorKey(allQueryKey)
      }
    }

    void loadAllMatches()
    return () => { active = false }
  }, [allQueryKey, debouncedFilters.search, premium, status, triggerMatches])

  const isLoading = status === 'All'
    ? allMatchesResult?.key !== allQueryKey && allMatchesErrorKey !== allQueryKey
    : matchQuery.isLoading
  const isError = status === 'All' ? allMatchesErrorKey === allQueryKey : matchQuery.isError
  const isFetching = status === 'All' ? isLoading : matchQuery.isFetching
  const matches = status === 'All'
    ? allMatchesResult?.key === allQueryKey ? allMatchesResult.items : emptyMatches
    : matchQuery.data?.items ?? emptyMatches

  const activeMatches = useMemo(() => {
    if (isRecent) {
      return [...matches].sort((left, right) => Date.parse(right.finishedAt ?? '') - Date.parse(left.finishedAt ?? ''))
    }
    if (status === 'UPCOMING') {
      const now = new Date()
      const nowTime = now.getTime()
      const windowEnd = getMatchCalendarWindowEnd(now, 2)
      const windowEndTime = windowEnd ? new Date(windowEnd).getTime() : nowTime
      return sortMatches(filterMatches(matches, 'UPCOMING', premium)).filter((match) => {
        const kickoffAt = new Date(match.kickoffAt).getTime()
        return Number.isFinite(kickoffAt) && kickoffAt >= nowTime && kickoffAt < windowEndTime
      })
    }
    return sortMatches(filterMatches(matches, normalizedStatus, premium))
  }, [isRecent, matches, normalizedStatus, premium, status])
  const visibleMatches = activeMatches
  const hasNoMatches = !isLoading && (isError || visibleMatches.length === 0)

  return (
    <div className="app-page space-y-6">
      <section className="premium-border relative overflow-hidden rounded-3xl bg-(--surface-soft)/70 p-5 sm:p-6">
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-(--text-primary) sm:text-4xl">All Matches</h1>
          </div>
          <div className="relative w-full md:w-72">
            <div className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center justify-center">
              <Search className="text-(--text-muted)" size={18} />
            </div>
            <Input
              placeholder="Search matches..."
              value={search}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value, page: 1 }))}
              className="pl-10"
            />
          </div>
        </div>
      </section>

      <Card className="premium-border flex flex-col items-center justify-between gap-4 bg-(--surface-soft)/70 p-4 md:flex-row md:flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          {statusFilters.map((option) => {
            const isActive = status === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilters(prev => ({ ...prev, status: option.value }))}
                className={cn(
                  'rounded-full border px-3.5 py-2 text-sm font-medium transition-colors duration-200',
                  isActive ?
                    'border-(--accent)/60 bg-(--accent-soft) text-(--accent)' :
                    'border-(--border) bg-(--surface-soft)/55 text-(--text-muted) hover:border-(--accent)/40 hover:text-(--text-primary)',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        <div className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row">
          <div className="flex w-full items-center space-x-2 sm:w-auto">
            <Checkbox id="premium" checked={premium === true} onCheckedChange={(checked) => setFilters(prev => ({ ...prev, premium: checked === true, page: 1 }))} />
            <Label htmlFor="premium" className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-(--text-primary)">
              <span className="flex items-center justify-center rounded-md bg-yellow-500/15 p-1 text-yellow-500">
                <Star size={14} className="text-white" />
              </span>
              Premium Only
            </Label>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between text-xs text-(--text-muted)" aria-live="polite">
        <span>{isFetching ? 'Refreshing matches...' : `${visibleMatches.length} matches`}</span>
        {status !== 'All' && <span>{status}</span>}
      </div>

      <div className="grid min-h-[50vh] grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && Array.from({ length: 9 }).map((_, index) => <MatchCardSkeleton key={index} />)}
        {hasNoMatches && (
          <Card className="col-span-full flex min-h-[clamp(22rem,50vh,34rem)] w-full flex-col items-center justify-center gap-5 border-(--border) bg-(--surface-soft)/55 p-6 text-center shadow-[0_24px_70px_rgba(2,6,23,0.12)] sm:p-10">
            <CardContent className="flex flex-col items-center justify-center gap-4">
              <div className="flex items-center justify-center rounded-full border border-(--accent)/30 bg-(--accent)/10 p-4 text-(--accent)">
                <Search className="h-12 w-12 text-(--text-muted)" />
              </div>
              <h3 className="text-xl font-semibold text-(--text-primary) sm:text-2xl">No Matches Found</h3>
              <p className="max-w-xl text-sm leading-6 text-(--text-muted) sm:text-base">
                {isError ? 'There was an error fetching matches.' : isRecent ? 'No recently completed matches from the last 7 days.' : 'Try adjusting your filters to find what you\'re looking for.'}
              </p>
            </CardContent>
          </Card>
        )}
        {visibleMatches.map((match) => (
          <MatchCardItem key={match.id} match={match} onOpen={openMatch} />
        ))}
      </div>
    </div>
  )
}