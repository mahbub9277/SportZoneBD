import { memo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

import type { Match } from '../features/matches/matches.types'
import { Card, CardContent } from './ui/Card'
import { cn } from '../lib/utils'
import { buildCloudinaryUrl } from '../utils/cloudinary'
import { getMatchStatus } from '../features/matches/matchOrdering'
import { getMatchCompetitionLabel } from '../features/matches/matchCompetition'
import { formatMatchKickoffDate, formatMatchKickoffTime } from '../utils/matchDateTime'
import { useCountdown } from '../hooks/useCountdown'
import { usePerformanceProfile } from '../hooks/usePerformanceProfile'
import { MarqueeText } from './MarqueeText'
import { VsIcon } from './VsIcon'
import { LIVE_BADGE_CLASS, LIVE_DOT_CLASS, LIVE_TEXT_CLASS } from '../utils/liveStatus'

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

const buildTeamVisual = (name: string, fallbackText: string, logo?: string | null) => {
  const normalizedLogo = logo?.trim()
  let imageUrl: string | null = null
  if (normalizedLogo) {
    if (/^[a-z][a-z\d+.-]*:/i.test(normalizedLogo)) {
      try {
        const url = new URL(normalizedLogo)
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          imageUrl = buildCloudinaryUrl(normalizedLogo, { width: 96, height: 96, crop: 'fit', quality: 'auto', format: 'auto' })
        }
      } catch {
        imageUrl = null
      }
    } else {
      imageUrl = buildCloudinaryUrl(normalizedLogo, { width: 96, height: 96, crop: 'fit', quality: 'auto', format: 'auto' })
    }
  }

  return { name: getTeamName(name, fallbackText), logo: imageUrl }
}

export const MatchCardDisplay = memo(function MatchCardDisplay({ match, onOpen, compact = false }: MatchCardDisplayProps) {
  const navigate = useNavigate()
  const { deviceTier, isSmartTV, reducedMotion, shouldReduceEffects } = usePerformanceProfile()
  const simplifyMatchCard = deviceTier === 'low' || isSmartTV || shouldReduceEffects || reducedMotion
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
  const competitionLabel = getMatchCompetitionLabel(match)
  const streamCount = match.streams?.filter((stream) => stream.enabled !== false && stream.isEnabled !== false).length ?? 0

  const homeTeam = buildTeamVisual(match.homeTeamName ?? match.homeTeam?.name ?? '', 'Team 1', match.homeTeamLogo || match.homeTeam?.logoUrl)
  const awayTeam = buildTeamVisual(match.awayTeamName ?? match.awayTeam?.name ?? '', 'Team 2', match.awayTeamLogo || match.awayTeam?.logoUrl)

  return (
    <div className="h-full w-full min-w-0">
      <Card
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        role="link"
        tabIndex={0}
        aria-label={`Open ${displayTitle}`}
        className={cn(
          'group relative flex h-full w-full min-h-0 cursor-pointer flex-col overflow-hidden rounded-2xl border border-(--border)/50 bg-(--surface)/95 p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)',
          simplifyMatchCard ? 'shadow-[0_10px_28px_rgba(4,116,196,0.08)] transition-transform duration-150' : 'shadow-[0_10px_28px_rgba(4,116,196,0.08)] transition-transform duration-200 hover:-translate-y-0.5',
        )}
      >
        <div className="relative overflow-hidden bg-(--surface-strong) px-3 pb-3 pt-3 sm:px-4 sm:pb-4 sm:pt-4">
          <div className="mb-2.5 flex items-center gap-2 border-b border-(--border) pb-2 sm:mb-3 sm:gap-3 sm:pb-2.5">
            {/* The team logos and names below already show the fixture, so the top line carries the
                competition context instead of repeating "Home vs Away". */}
            {competitionLabel && (
              <MarqueeText
                text={competitionLabel}
                animated={!simplifyMatchCard}
                className="min-w-0 flex-1 text-[11px] font-medium tracking-wide text-(--text-muted) sm:text-xs"
              />
            )}
            <time dateTime={match.kickoffAt} className="ml-auto shrink-0 text-[10px] font-medium text-(--text-muted) sm:text-xs">
              {matchStatus === 'LIVE' ? <span className={cn('font-semibold', LIVE_TEXT_CLASS)}>{timer.elapsedFormatted}</span> : <span>{formatMatchKickoffTime(match.kickoffAt)} <span className="mx-1 text-(--border)">·</span> {formatMatchKickoffDate(match.kickoffAt)}</span>}
            </time>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 sm:gap-5">
            <div className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:gap-2">
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden sm:h-20 sm:w-20">
                {homeTeam.logo && !homeLogoFailed ? (
                  <img src={homeTeam.logo} alt={homeTeam.name} loading="lazy" decoding="async" className="h-full w-full object-contain p-1.5" onError={() => setHomeLogoFailed(true)} />
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-(--text-muted)">{homeTeam.name.slice(0, 2)}</span>
                )}
              </div>
              <p className="w-full wrap-break-word text-[11px] font-semibold leading-4 text-(--text-primary) sm:text-sm sm:leading-5">{homeTeam.name}</p>
            </div>

            {/* The mark is centred on the logo row so the fixture reads as one line: logos, mark, logos. */}
            <div className="flex h-14 items-center justify-center pt-1 sm:h-20 sm:pt-2"><VsIcon /></div>

            <div className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:gap-2">
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden sm:h-20 sm:w-20">
                {awayTeam.logo && !awayLogoFailed ? (
                  <img src={awayTeam.logo} alt={awayTeam.name} loading="lazy" decoding="async" className="h-full w-full object-contain p-1.5" onError={() => setAwayLogoFailed(true)} />
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-(--text-muted)">{awayTeam.name.slice(0, 2)}</span>
                )}
              </div>
              <p className="w-full wrap-break-word text-[11px] font-semibold leading-4 text-(--text-primary) sm:text-sm sm:leading-5">{awayTeam.name}</p>
            </div>
          </div>
        </div>

        <CardContent className={cn(compact ? 'p-1.5' : 'p-2 sm:p-2.5')}>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2.5 gap-y-1.5 rounded-xl border border-(--border)/60 bg-(--surface-soft)/60 px-2 py-1.5 text-[10px] font-semibold sm:px-2.5 sm:py-2 sm:text-xs" aria-live="polite">
            <span className="min-w-0 truncate text-(--text-muted)">{streamCount} stream{streamCount === 1 ? '' : 's'} available</span>
            <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 uppercase tracking-[0.06em]', matchStatus === 'LIVE' ? LIVE_BADGE_CLASS : matchStatus === 'FINISHED' ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
              {matchStatus === 'LIVE' && <span className={cn('h-1.5 w-1.5 rounded-full', LIVE_DOT_CLASS, simplifyMatchCard ? '' : 'animate-pulse')} aria-hidden="true" />}
              {matchStatus === 'LIVE' ? 'LIVE' : matchStatus === 'FINISHED' ? 'FINISHED' : 'UPCOMING'}
            </span>
            {match.premium && <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-yellow-500/25 bg-yellow-500/10 px-2 py-1 text-yellow-700 dark:text-yellow-400"><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Premium</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
})