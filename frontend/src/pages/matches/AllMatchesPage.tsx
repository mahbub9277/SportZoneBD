import { motion, useReducedMotion } from 'framer-motion'
import { useGetMatchesQuery } from '../../features/matches/matches.api'
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

const matchStatuses = ['LIVE', 'UPCOMING'] as const
const emptyMatches: Match[] = []
const statusFilters = [
  { value: 'Recent', label: 'Recent' },
  { value: 'All', label: 'All' },
  { value: 'LIVE', label: 'Live' },
  { value: 'UPCOMING', label: 'Upcoming' },
] as const

type MatchStatus = (typeof matchStatuses)[number]

const normalizeStatus = (status?: string) => {
  if (!status) return undefined
  const upperStatus = status.toUpperCase()
  if (upperStatus === 'ALL') return undefined
  return matchStatuses.includes(upperStatus as MatchStatus) ? (upperStatus as MatchStatus) : undefined
}

export function AllMatchesPage() {
  const openMatch = useAdvertisementGate('MATCH')
  const shouldReduceMotion = useReducedMotion()

  const { filters, setFilters, debouncedFilters } = useFilterState({
    search: '',
    status: 'All',
    premium: false,
  }, ['search']);

  const { search, status, premium } = filters
  const normalizedStatus = normalizeStatus(status)
  const { data, isLoading, isError, isFetching } = useGetMatchesQuery({
    page: 1,
    limit: 100,
    search: debouncedFilters.search,
    status: normalizedStatus,
    premium: premium,
    activeOnly: true,
  }, { refetchOnMountOrArgChange: true })

  const activeMatches = sortMatches(filterMatches(data?.items ?? emptyMatches, undefined, premium))
  const visibleMatches = status === 'Recent'
    ? activeMatches.slice(0, 6)
    : sortMatches(filterMatches(activeMatches, normalizedStatus as MatchStatus | undefined, premium))
  const counts = {
    Recent: Math.min(activeMatches.length, 6),
    All: activeMatches.length,
    LIVE: activeMatches.filter((match) => match.status?.toUpperCase() === 'LIVE').length,
    UPCOMING: activeMatches.filter((match) => match.status?.toUpperCase() === 'UPCOMING').length,
  }
  const hasNoMatches = !isLoading && (isError || visibleMatches.length === 0)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="space-y-6">
      <motion.section initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }} className="premium-border relative overflow-hidden rounded-3xl bg-surface-soft/70 p-5 sm:p-6">
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">All Matches</h1>
          </div>
          <div className="relative w-full md:w-72">
            <div className="absolute left-3 top-1/2 flex -translate-y-1/2 items-center justify-center">
              <Search className="text-text-muted" size={18} />
            </div>
            <Input
              placeholder="Search matches..."
              value={search}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value, page: 1 }))}
              className="pl-10"
            />
          </div>
        </div>
      </motion.section>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>
      <Card className="premium-border flex flex-col items-center justify-between gap-4 bg-surface-soft/70 p-4 md:flex-row md:flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          {statusFilters.map((option) => {
            const isActive = status === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilters(prev => ({ ...prev, status: option.value }))}
                className={cn(
                  'rounded-full border px-3.5 py-2 text-sm font-medium transition duration-200',
                  isActive ?
                    'border-[#0474C4]/40 bg-linear-to-r from-[#0474C4] to-[#06457F] text-white shadow-[0_0_18px_rgba(4,116,196,0.24)]' :
                    'border-[#A8C4EC]/15 bg-[#262B40]/55 text-[#A8C4EC] hover:border-[#0474C4]/40 hover:bg-[#2C444C]/60 hover:text-white',
                )}
              >
                {option.label} ({counts[option.value]})
              </button>
            )
          })}
        </div>
        <div className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row">
          <div className="flex w-full items-center space-x-2 sm:w-auto">
            <Checkbox id="premium" checked={premium === true} onCheckedChange={(checked) => setFilters(prev => ({ ...prev, premium: checked === true, page: 1 }))} />
            <Label htmlFor="premium" className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-text-primary">
              <span className="flex items-center justify-center rounded-md bg-yellow-500/15 p-1 text-yellow-500">
                <Star size={14} className="text-white" />
              </span>
              Premium Only
            </Label>
          </div>
        </div>
      </Card>
      </motion.div>

      <div className="flex items-center justify-between text-xs text-text-muted" aria-live="polite">
        <span>{isFetching ? 'Refreshing matches...' : `${visibleMatches.length} matches`}</span>
        {status !== 'All' && <span>{status}</span>}
      </div>

      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }} className="grid min-h-[50vh] grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && Array.from({ length: 9 }).map((_, index) => <MatchCardSkeleton key={index} />)}
        {hasNoMatches && (
          <Card className="col-span-full flex min-h-[clamp(22rem,50vh,34rem)] w-full flex-col items-center justify-center gap-5 border-dashed border-border/80 bg-surface-soft/55 p-6 text-center shadow-[0_24px_70px_rgba(2,6,23,0.12)] sm:p-10">
            <CardContent className="flex flex-col items-center justify-center gap-4">
              <div className="flex items-center justify-center rounded-full border border-dashed border-accent/40 bg-accent/10 p-4 text-accent">
                <Search className="h-12 w-12 text-text-muted" />
              </div>
              <h3 className="text-xl font-semibold text-text-primary sm:text-2xl">No Matches Found</h3>
              <p className="max-w-xl text-sm leading-6 text-text-muted sm:text-base">
                {isError ? 'There was an error fetching matches.' : 'Try adjusting your filters to find what you\'re looking for.'}
              </p>
            </CardContent>
          </Card>
        )}
        {visibleMatches.map((match, index) => (
          <motion.div
            key={match.id || index}
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.24, delay: shouldReduceMotion ? 0 : Math.min(index * 0.04, 0.24), ease: 'easeOut' }}
          >
            <MatchCardDisplay match={match} onOpen={() => openMatch(`/matches/${match.id}`, match.premium === true)} />
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}