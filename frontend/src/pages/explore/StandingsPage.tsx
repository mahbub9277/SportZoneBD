import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { BarChart3, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/Card'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/Tabs'
import { PageHero } from '../../components/shared/PageHero'
import { useGetStandingsQuery } from '../../features/standings/standings.api'

const LEAGUES = [
  { id: '39', label: 'Premier League' },
  { id: '140', label: 'La Liga' },
  { id: '135', label: 'Serie A' },
  { id: '78', label: 'Bundesliga' },
  { id: '61', label: 'Ligue 1' },
  { id: '1', label: 'UEFA Champions League' },
  { id: '41', label: 'EFL Championship' },
]

export function StandingsPage() {
  const [selectedLeagueId, setSelectedLeagueId] = useState('39')
  const shouldReduceMotion = useReducedMotion()
  const { data, isLoading, isFetching, isError, error, refetch } = useGetStandingsQuery({ leagueId: selectedLeagueId })
  const standings = data?.table ?? []
  const leagueName = data?.league.name ?? 'Top Flight'
  const season = data?.league.season ?? new Date().getFullYear()
  const isEmptyState = !isLoading && !isError && standings.length === 0
  const errorMessage = typeof error === 'object' && error && 'data' in error && typeof error.data === 'object' && error.data && 'message' in error.data && typeof error.data.message === 'string'
    ? error.data.message
    : 'Standings are currently unavailable. Please try again later.'

  return (
    <div className="app-page space-y-3">
      <PageHero
        title="Standings"
        description="Track the current table and see how the title race is shaping up."
        eyebrow="League pulse"
        icon={BarChart3}
      >
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="hidden min-h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
          aria-label="Refresh standings"
        >
          <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          Refresh
        </button>
      </PageHero>

      <div className="space-y-4">
        <div className="sm:hidden">
          <label htmlFor="standings-league-select" className="sr-only">
            Select league
          </label>
          <select
            id="standings-league-select"
            value={selectedLeagueId}
            onChange={(event) => setSelectedLeagueId(event.target.value)}
            className="w-full rounded-3xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
          >
            {LEAGUES.map((league) => (
              <option key={league.id} value={league.id}>
                {league.label}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden rounded-4xl border border-border/60 bg-surface-soft/80 p-4 shadow-[0_16px_50px_rgba(2,6,23,0.12)] sm:block">
          <Tabs value={selectedLeagueId} onValueChange={setSelectedLeagueId}>
            <TabsList>
              {LEAGUES.map((league) => (
                <TabsTrigger key={league.id} value={league.id} className="min-w-40">
                  {league.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <motion.div
        className="min-w-0 overflow-x-auto rounded-4xl overscroll-x-contain"
        initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.3, ease: 'easeOut' }}
      >
        <Card className="min-w-184 overflow-hidden border-border bg-surface-soft/70 p-0">
          <div className="grid gap-4 border-b border-border bg-surface/70 px-4 py-4 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-text-muted">League</p>
              <p className="mt-1 font-semibold text-text-primary">{leagueName}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Season</p>
              <p className="mt-1 font-semibold text-text-primary">{season}-{season + 1}</p>
            </div>
            <div className="sm:text-right md:text-right">
              <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Last refreshed</p>
              <p className="mt-1 font-semibold text-text-primary">{isLoading || isFetching ? 'Updating…' : 'API Football'}</p>
            </div>
          </div>

          <CardContent className="p-0">
            <div className="min-w-0">
              <div className="grid min-w-180 border-b border-border bg-surface/70 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted" style={{ gridTemplateColumns: '40px minmax(190px, 1fr) repeat(8, minmax(48px, auto))' }}>
                <span>#</span>
                <span>Team</span>
                <span className="text-center">Pl</span>
                <span className="text-center">W</span>
                <span className="text-center">D</span>
                <span className="text-center">L</span>
                <span className="text-center">GF</span>
                <span className="text-center">GA</span>
                <span className="text-center">GD</span>
                <span className="text-right">Pts</span>
              </div>
              {isLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="h-12 animate-pulse rounded-2xl bg-surface" />
                  ))}
                </div>
              ) : isError ? (
                <div className="space-y-4 p-6 text-center">
                  <div className="text-sm text-text-muted">{errorMessage}</div>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="inline-flex items-center gap-2 rounded-full border border-accent bg-surface px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent hover:text-surface disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                    Retry
                  </button>
                </div>
              ) : isEmptyState ? (
                <div className="p-6 text-center text-sm text-text-muted">No standings data is available for the selected league right now.</div>
              ) : (
                standings.map((entry) => (
                  <div key={`${entry.team.id}-${entry.rank}`} className="grid min-w-180 items-center border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface/60" style={{ gridTemplateColumns: '40px minmax(190px, 1fr) repeat(8, minmax(48px, auto))' }}>
                    <span className="text-sm font-semibold text-text-primary">{entry.rank}</span>
                    <div className="flex items-center gap-3">
                      {entry.team.logo && (
                        <img src={entry.team.logo} alt={`${entry.team.name} logo`} loading="lazy" decoding="async" className="h-7 w-7 rounded-full object-contain" />
                      )}
                      <span className="text-sm font-medium text-text-primary">{entry.team.name}</span>
                    </div>
                    <span className="text-center text-sm text-text-muted">{entry.played}</span>
                    <span className="text-center text-sm text-text-muted">{entry.win}</span>
                    <span className="text-center text-sm text-text-muted">{entry.draw}</span>
                    <span className="text-center text-sm text-text-muted">{entry.loss}</span>
                    <span className="text-center text-sm text-text-muted">{entry.goalsFor}</span>
                    <span className="text-center text-sm text-text-muted">{entry.goalsAgainst}</span>
                    <span className={`text-center text-sm font-semibold ${entry.goalDifference > 0 ? 'text-emerald-400' : entry.goalDifference < 0 ? 'text-red-400' : 'text-text-muted'}`}>{entry.goalDifference > 0 ? `+${entry.goalDifference}` : entry.goalDifference}</span>
                    <span className="text-right text-sm font-semibold text-text-primary">{entry.points}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Card className="flex items-center justify-between gap-4 border-border bg-surface-soft/70 p-5">
        <div>
          <p className="text-sm font-semibold text-text-primary">Current football table</p>
          <p className="mt-1 text-sm text-text-muted">Official standings are loaded from API-Football and cached briefly by the backend.</p>
        </div>
        <BarChart3 className="h-4 w-4 text-accent" />
      </Card>
    </div>
  )
}
