import { memo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { motion } from 'framer-motion'

import type { Match } from '../features/matches/matches.types'
import { Card, CardContent } from './ui/Card'
import { cn } from '../lib/utils'
import { buildCloudinaryUrl } from '../utils/cloudinary'
import { getMatchStatus } from '../features/matches/matchOrdering'
import { formatMatchKickoffDate, formatMatchKickoffTime } from '../utils/matchDateTime'
import { useCountdown } from '../hooks/useCountdown'

interface MatchCardDisplayProps {
  match: Match
  onOpen?: () => void
  compact?: boolean
}

const getMatchDisplayTitle = (match: Match) => {
  if (match.title?.trim()) return match.title.trim()
  if (match.tournamentName?.trim()) return match.tournamentName.trim()
  if (match.competition?.name?.trim()) return match.competition.name.trim()
  return 'Match'
}

const getTeamName = (value: string | null | undefined, fallback: string) => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

const buildTeamVisual = (name: string, fallbackText: string, logo?: string | null) => ({
  name: getTeamName(name, fallbackText),
  logo: logo && logo.trim() ? buildCloudinaryUrl(logo, { width: 96, height: 96, crop: 'fit', quality: 'auto', format: 'auto' }) : null,
})

export const MatchCardDisplay = memo(function MatchCardDisplay({ match, onOpen, compact = false }: MatchCardDisplayProps) {
  const navigate = useNavigate()
  const [homeLogoFailed, setHomeLogoFailed] = useState(false)
  const [awayLogoFailed, setAwayLogoFailed] = useState(false)
  const matchStatus = getMatchStatus(match) ?? 'UPCOMING'
  const timer = useCountdown(matchStatus === 'UPCOMING' || matchStatus === 'LIVE' ? match.kickoffAt : null)
  const handleCardClick = () => {
    if (onOpen) {
      onOpen()
      return
    }
    navigate(`/matches/${match.id}`)
  }

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleCardClick()
    }
  }

  const displayTitle = getMatchDisplayTitle(match)
  const streamCount = match.streams?.filter((stream) => stream.enabled !== false && stream.isEnabled !== false).length ?? 0

  const homeTeam = buildTeamVisual(match.homeTeamName ?? '', 'Team 1', match.homeTeamLogo ?? null)
  const awayTeam = buildTeamVisual(match.awayTeamName ?? '', 'Team 2', match.awayTeamLogo ?? null)

  return (
    <motion.div className="h-full w-full min-w-0">
      <Card
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        role="link"
        tabIndex={0}
        aria-label={`Open ${displayTitle}`}
        className="group relative flex h-full w-full min-h-0 cursor-pointer flex-col overflow-hidden rounded-2xl border border-(--border)/80 bg-(--surface)/95 p-0 text-left shadow-[0_10px_28px_rgba(4,116,196,0.08)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
      >
        <div className="relative overflow-hidden bg-(--surface-strong) px-3 pb-4 pt-4 sm:px-4">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-(--border) pb-2.5">
            <p className="min-w-0 truncate text-sm font-semibold text-(--text-primary) sm:text-base">{displayTitle}</p>
            <time dateTime={match.kickoffAt} className="shrink-0 text-[10px] font-medium text-(--text-muted) sm:text-xs">
              {matchStatus === 'LIVE' ? <span className="text-rose-500 dark:text-rose-300">{timer.elapsedFormatted}</span> : <span>{formatMatchKickoffTime(match.kickoffAt)} <span className="mx-1 text-(--border)">·</span> {formatMatchKickoffDate(match.kickoffAt)}</span>}
            </time>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 sm:gap-4">
            <div className="flex min-w-0 flex-col items-center gap-2 text-center">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden sm:h-20 sm:w-20">
                {homeTeam.logo && !homeLogoFailed ? (
                  <img src={homeTeam.logo} alt={homeTeam.name} className="h-full w-full object-contain p-1.5" onError={() => setHomeLogoFailed(true)} />
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-(--text-muted)">{homeTeam.name.slice(0, 2)}</span>
                )}
              </div>
              <p className="w-full wrap-break-word text-xs font-semibold leading-4 text-(--text-primary) sm:text-sm sm:leading-5">{homeTeam.name}</p>
            </div>

            <div className="pt-8 text-[11px] font-black uppercase tracking-[0.16em] text-(--accent) sm:pt-10 sm:text-xs">VS</div>

            <div className="flex min-w-0 flex-col items-center gap-2 text-center">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden sm:h-20 sm:w-20">
                {awayTeam.logo && !awayLogoFailed ? (
                  <img src={awayTeam.logo} alt={awayTeam.name} className="h-full w-full object-contain p-1.5" onError={() => setAwayLogoFailed(true)} />
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-(--text-muted)">{awayTeam.name.slice(0, 2)}</span>
                )}
              </div>
              <p className="w-full wrap-break-word text-xs font-semibold leading-4 text-(--text-primary) sm:text-sm sm:leading-5">{awayTeam.name}</p>
            </div>
          </div>
        </div>

        <CardContent className={cn('space-y-2', compact ? 'p-1.5' : 'p-2 sm:p-2.5')}>
          {(match.tournamentName?.trim() || match.competition?.name) && <p className="truncate text-[10px] font-medium text-(--text-muted) sm:text-xs">{match.tournamentName?.trim() || match.competition?.name}</p>}
          <div className="flex min-w-0 items-center justify-between gap-2 border-t border-(--border) pt-2 text-[10px] font-semibold sm:text-xs" aria-live="polite">
            <span className="min-w-0 truncate text-(--text-muted)">{streamCount} stream{streamCount === 1 ? '' : 's'} available</span>
            <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1', matchStatus === 'LIVE' ? 'bg-rose-500/12 text-rose-600 dark:text-rose-300' : matchStatus === 'FINISHED' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/12 text-amber-700 dark:text-amber-300')}>
              {matchStatus === 'LIVE' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}
              {matchStatus === 'LIVE' ? 'LIVE' : matchStatus === 'FINISHED' ? 'FINISHED' : 'UPCOMING'}
            </span>
            {match.premium && <span className="inline-flex shrink-0 items-center gap-1 text-yellow-600 dark:text-yellow-400"><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Premium</span>}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
})