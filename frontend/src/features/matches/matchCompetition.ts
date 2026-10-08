import type { Match } from './matches.types'
import { getMatchCalendarYear } from '../../utils/matchDateTime.ts'

/**
 * Competition context for a match card: "Football || La Liga 2026/2027 - Round 8",
 * "Cricket || Australia in South Africa, 2026".
 *
 * Every part is taken from data the match really carries. The match table has no season or round
 * column, so those are only shown when the real competition/title text (or a future provider field)
 * actually contains them; nothing is inferred, defaulted or invented.
 */

/** Sport codes are stored uppercase; the card shows the sport the way the application names it. */
const SPORT_LABELS: Record<string, string> = {
  FOOTBALL: 'Football',
  CRICKET: 'Cricket',
  BASKETBALL: 'Basketball',
  TENNIS: 'Tennis',
  MOTORSPORTS: 'Motorsports',
  WWE: 'WWE',
}

/** A season as real competition metadata writes it: 2026/2027, 2026-27, 2026/27. */
const SEASON_PATTERN = /(?:^|[^\d])((?:19|20)\d{2}\s*[/–-]\s*\d{2,4})(?![\d])/
/** A round as real match metadata writes it: "Round 8", "Matchday 12", "Round of 16". */
const ROUND_PATTERN = /\b(?:round|matchday)\s+(?:of\s+)?(\d{1,3})\b/i
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/

export const getMatchSportLabel = (sport?: string | null): string | null => {
  const code = sport?.trim().toUpperCase()
  if (!code) return null
  return SPORT_LABELS[code] ?? `${code.charAt(0)}${code.slice(1).toLowerCase()}`
}

/** The competition the match is filed under, using only the match's own real fields. */
export const getMatchCompetitionName = (match: Match): string | null => {
  const tournament = match.tournamentName?.trim()
  if (tournament) return tournament
  const competition = match.competition?.name?.trim()
  return competition && competition.length > 0 ? competition : null
}

const readPositiveInteger = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim())
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

/** Round number, taken from a real round field or a real "Round N"/"Matchday N" token in stored text. */
const readRound = (match: Match): number | null => {
  const explicit = readPositiveInteger(match.round)
  if (explicit !== null) return explicit

  for (const source of [match.tournamentName, match.title]) {
    const found = source ? ROUND_PATTERN.exec(source) : null
    const value = found ? readPositiveInteger(found[1]) : null
    if (value !== null) return value
  }

  return null
}

/** Season, taken from a real season field or a real "2026/2027" token already present in stored text. */
const readSeason = (match: Match): string | null => {
  const explicit = match.season
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  if (typeof explicit === 'number' && Number.isInteger(explicit) && explicit > 0) return String(explicit)

  for (const source of [match.tournamentName, match.title]) {
    const found = source ? SEASON_PATTERN.exec(source) : null
    if (found) return found[1].replace(/\s+/g, '')
  }

  return null
}

const describeCompetition = (sportCode: string, competition: string, match: Match): string => {
  if (sportCode === 'FOOTBALL') {
    const season = readSeason(match)
    const round = readRound(match)
    const withSeason = season && !SEASON_PATTERN.test(competition) ? `${competition} ${season}` : competition
    return round !== null && !ROUND_PATTERN.test(competition) ? `${withSeason} - Round ${round}` : withSeason
  }

  if (sportCode === 'CRICKET') {
    // Cricket competitions are named for a tour inside a calendar year, so the match's own year is the
    // series year; it is omitted when the real series name already carries it.
    const year = getMatchCalendarYear(match.kickoffAt)
    return year !== null && !YEAR_PATTERN.test(competition) ? `${competition}, ${year}` : competition
  }

  return competition
}

/** The card's top context line, or null when the match carries no sport/competition metadata at all. */
export const getMatchCompetitionLabel = (match: Match): string | null => {
  const sportCode = match.sport?.trim().toUpperCase() ?? ''
  const sport = getMatchSportLabel(match.sport)
  const competition = getMatchCompetitionName(match)
  if (!sport && !competition) return null

  const described = competition ? describeCompetition(sportCode, competition, match) : null
  if (!sport) return described
  return described ? `${sport} || ${described}` : sport
}
