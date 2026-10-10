import { useState } from 'react'
import { AlertCircle, BarChart3, RefreshCw, Trophy } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import { PageHero } from '../../components/shared/PageHero'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/Select'
import { Skeleton } from '../../components/ui/Skeleton'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/Tabs'
import { useGetLeagueStandingsQuery } from '../../features/standings/standings.api'
import type { LeagueCode, LeagueStanding } from '../../features/standings/standings.types'
import { useGetStandingsCompetitionsQuery } from '../../features/standings/standings.api'
import { selectTeamLogo, teamInitials } from '../../utils/teamLogo'

const SKELETON_ROWS = Array.from({ length: 8 }, (_, index) => index)

export function StandingsPage() {
  const [selectedLeagueCode, setSelectedLeagueCode] = useState<LeagueCode>('PL')
  const { data: competitions = [] } = useGetStandingsCompetitionsQuery()
  const selectedCompetition = competitions.find(({ code }) => code === selectedLeagueCode)
  const canLoadStandings = selectedCompetition?.standingsSupported === true
  const { currentData, isFetching, isError, refetch } = useGetLeagueStandingsQuery(
    { leagueCode: selectedLeagueCode },
    { skip: !canLoadStandings },
  )
  const isInitialLoading = isFetching && !currentData

  return (
    <main className="app-page space-y-4">
      <PageHero
        title="League standings"
        description="Follow the table across supported competitions."
        eyebrow="Football tables"
        icon={BarChart3}
      >
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching || !canLoadStandings} aria-label="Refresh standings">
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </PageHero>

      <section aria-label="Choose competition" className="space-y-3">
        <div className="sm:hidden">
          <label htmlFor="standings-competition" className="sr-only">Select competition</label>
          <Select value={selectedLeagueCode} onValueChange={(value) => setSelectedLeagueCode(value as LeagueCode)}>
            <SelectTrigger id="standings-competition" className="min-h-12 rounded-xl">
              <SelectValue placeholder="Select competition" />
            </SelectTrigger>
            <SelectContent>
              {competitions.map((competition) => (
                <SelectItem key={competition.code} value={competition.code}>{competition.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="hidden rounded-2xl border border-(--border) bg-(--surface-soft)/70 p-2 sm:block">
          <Tabs value={selectedLeagueCode} onValueChange={(value) => setSelectedLeagueCode(value as LeagueCode)}>
            <TabsList className="w-full flex-wrap bg-transparent shadow-none">
              {competitions.map((competition) => (
                <TabsTrigger key={competition.code} value={competition.code} className="min-h-10 flex-1 rounded-xl px-3">
                  {competition.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </section>

      {isInitialLoading && <StandingsLoadingState />}

      {selectedCompetition && !selectedCompetition.standingsSupported && (
        <Card className="border-dashed border-(--border) bg-(--surface-soft)/50 shadow-none">
          <CardContent className="py-12 text-center">
            <Trophy className="mx-auto h-8 w-8 text-(--text-muted)" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-(--text-primary)">Standings are not available</h2>
            <p className="mt-1 text-sm text-(--text-muted)">football-data.org does not provide current standings for this tournament.</p>
          </CardContent>
        </Card>
      )}

      {isError && !currentData && (
        <Card role="alert" className="border-(--danger)/30 bg-(--danger-soft)/30 shadow-none">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <AlertCircle className="h-8 w-8 text-(--danger)" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-(--text-primary)">Standings are temporarily unavailable.</h2>
              <p className="mt-1 text-sm text-(--text-muted)">Please try again shortly.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!isInitialLoading && !isError && currentData?.standings.length === 0 && (
        <Card className="border-dashed border-(--border) bg-(--surface-soft)/50 shadow-none">
          <CardContent className="py-12 text-center">
            <Trophy className="mx-auto h-8 w-8 text-(--text-muted)" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-(--text-primary)">No standings available</h2>
            <p className="mt-1 text-sm text-(--text-muted)">There are no table entries for this competition right now.</p>
          </CardContent>
        </Card>
      )}

      {currentData && currentData.standings.length > 0 && (
        <Card className="overflow-hidden rounded-2xl border-(--border) bg-(--surface)/90 shadow-none">
          <div className="flex flex-col gap-4 border-b border-(--border) bg-(--surface-soft)/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <CompetitionEmblem key={currentData.competition.code} name={currentData.competition.name} src={currentData.competition.emblem} />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--text-muted)">{currentData.competition.code}</p>
                <h2 className="truncate text-lg font-semibold text-(--text-primary)">{currentData.competition.name}</h2>
                <p className="mt-0.5 text-sm text-(--text-muted)">
                  {formatSeason(currentData.season.id, currentData.season.startDate, currentData.season.endDate)}
                  {currentData.season.currentMatchday != null && ` · Matchday ${currentData.season.currentMatchday}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {isFetching && <span role="status" className="text-xs text-(--text-muted)">Updating table</span>}
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${currentData.meta.stale ? 'border-(--warning)/35 bg-(--warning-soft) text-(--warning)' : 'border-(--border) bg-(--surface-soft) text-(--text-muted)'}`}>
                {currentData.meta.stale ? 'Last available table' : currentData.meta.cached ? 'Cached' : 'football-data.org'}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-185 border-collapse text-sm">
              <caption className="sr-only">{currentData.competition.name} standings</caption>
              <thead className="sticky top-0 z-10 border-b border-(--border) bg-(--surface-strong) text-xs uppercase tracking-[0.08em] text-(--text-muted)">
                <tr>
                  <th scope="col" className="w-12 px-3 py-3 text-center font-semibold">#</th>
                  <th scope="col" className="min-w-52 px-3 py-3 text-left font-semibold">Team</th>
                  <StatHeader label="MP" description="Matches played" />
                  <StatHeader label="W" description="Won" />
                  <StatHeader label="D" description="Drawn" />
                  <StatHeader label="L" description="Lost" />
                  <StatHeader label="GF" description="Goals for" />
                  <StatHeader label="GA" description="Goals against" />
                  <StatHeader label="GD" description="Goal difference" />
                  <th scope="col" className="w-16 px-4 py-3 text-right font-semibold text-(--accent)">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)/70">
                {currentData.standings.map((standing) => (
                  <StandingsRow key={standing.team.id} standing={standing} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selectedCompetition && <p className="sr-only" aria-live="polite">Showing {selectedCompetition.name} standings.</p>}
    </main>
  )
}

function StatHeader({ label, description }: { label: string; description: string }) {
  return (
    <th scope="col" title={description} aria-label={description} className="w-14 px-2 py-3 text-right font-semibold">
      {label}
    </th>
  )
}

function StandingsRow({ standing }: { standing: LeagueStanding }) {
  return (
    <tr className="transition-colors hover:bg-(--surface-soft)/60">
      <td className="px-3 py-3 text-center font-medium tabular-nums text-(--text-muted)">{standing.position}</td>
      <td className="px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <TeamCrest standing={standing} />
          <div className="min-w-0">
            <p className="truncate font-medium text-(--text-primary)">{standing.team.name}</p>
            <p className="truncate text-xs text-(--text-muted)">
              {standing.team.shortName || standing.team.tla || standing.team.name}
              {standing.description && <span title={standing.description}> · {standing.description}</span>}
            </p>
          </div>
        </div>
      </td>
      <NumericCell value={standing.playedGames} />
      <NumericCell value={standing.won} />
      <NumericCell value={standing.draw} />
      <NumericCell value={standing.lost} />
      <NumericCell value={standing.goalsFor} />
      <NumericCell value={standing.goalsAgainst} />
      <NumericCell value={standing.goalDifference > 0 ? `+${standing.goalDifference}` : standing.goalDifference} />
      <td className="px-4 py-3 text-right font-bold tabular-nums text-(--accent)">{standing.points}</td>
    </tr>
  )
}

function NumericCell({ value }: { value: number | string }) {
  return <td className="px-2 py-3 text-right tabular-nums text-(--text-secondary)">{value}</td>
}

function TeamCrest({ standing }: { standing: LeagueStanding }) {
  const logo = selectTeamLogo([standing.team.assignedLogo, standing.team.crest], { width: 32, height: 32, crop: 'fit' })
  const [hasError, setHasError] = useState(false)
  const initials = teamInitials(standing.team.name, { shortName: standing.team.shortName, tla: standing.team.tla })

  if (hasError || !logo.url) {
    return <span aria-label={`${standing.team.name} crest unavailable`} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-(--border) bg-(--surface-soft) text-[10px] font-semibold text-(--text-muted)">{initials}</span>
  }

  return <img src={logo.url} alt={`${standing.team.name} crest`} width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setHasError(true)} className="h-8 w-8 shrink-0 rounded-full object-contain" />
}

function CompetitionEmblem({ name, src }: { name: string; src: string | null }) {
  const [hasError, setHasError] = useState(!src)
  if (hasError || !src) return <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-(--border) bg-(--surface-soft)"><Trophy className="h-5 w-5 text-(--accent)" aria-hidden="true" /></span>
  return <img src={src} alt={`${name} emblem`} width={44} height={44} decoding="async" referrerPolicy="no-referrer" onError={() => setHasError(true)} className="h-11 w-11 shrink-0 rounded-xl border border-(--border) bg-(--surface-soft) object-contain p-1" />
}

function StandingsLoadingState() {
  return (
    <Card aria-label="Loading standings" className="overflow-hidden rounded-2xl border-(--border) bg-(--surface)/90 shadow-none">
      <div className="flex items-center gap-3 border-b border-(--border) px-4 py-4 sm:px-5">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-5 w-48" /><Skeleton className="h-3 w-28" /></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-185 border-collapse" aria-hidden="true">
          <thead><tr>{Array.from({ length: 10 }, (_, index) => <th key={index} className="px-3 py-3"><Skeleton className="ml-auto h-3 w-8" /></th>)}</tr></thead>
          <tbody>{SKELETON_ROWS.map((row) => (
            <tr key={row} className="border-t border-(--border)/70">
              <td className="px-3 py-3"><Skeleton className="mx-auto h-4 w-4" /></td>
              <td className="px-3 py-2.5"><div className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 w-32" /></div></td>
              {Array.from({ length: 8 }, (_, index) => <td key={index} className="px-2 py-3"><Skeleton className="ml-auto h-4 w-6" /></td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  )
}

function formatSeason(id: number, startDate: string | null, endDate: string | null): string {
  const startYear = startDate?.slice(0, 4)
  const endYear = endDate?.slice(0, 4)
  if (startYear && endYear) return `${startYear}/${endYear.slice(-2)}`
  return String(id)
}
