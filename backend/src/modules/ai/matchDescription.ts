/**
 * Builds the one-line match description shown with an AI match suggestion.
 *
 * It is composed, not generated: every fragment comes from a value the administrator wrote or the
 * server resolved (sport, competition, the two sides, the local kickoff, the round), so the sentence
 * cannot invent a venue, a score, a form guide or a statistic. Composition also makes the length rule
 * decidable — fragments are added or dropped whole, the result is measured with the shared counting
 * rule, and when no truthful combination reaches the required length the function returns null and a
 * warning instead of padding the sentence with filler.
 */

import { checkDescriptionLength, type DescriptionLengthRange } from './descriptionLength.js'

export interface MatchDescriptionInput {
  sport: string | null
  tournamentName: string | null
  homeTeamName: string | null
  awayTeamName: string | null
  /** Local kickoff, already formatted in the business timezone (for example "18 Oct, 19:30"). */
  kickoffLabel: string | null
  round: number | null
  /** Expected running time, when the administrator or the sport's own rules supplied one. */
  durationMinutes?: number | null
  /** The quality stated for the stream, when one was given. */
  quality?: string | null
  /** The pre-start window, when pre-start coverage is enabled for this match. */
  preStartWindowMinutes?: number | null
}

export interface MatchDescriptionResult {
  description: string | null
  /** Present when no truthful sentence reached the required length. */
  warning: string | null
}

/** How each supported sport is named in a sentence. Unknown sports are left out rather than guessed. */
const SPORT_LABELS: Record<string, string> = {
  CRICKET: 'Cricket',
  FOOTBALL: 'Football',
  BASKETBALL: 'Basketball',
  TENNIS: 'Tennis',
  MOTORSPORTS: 'Motorsport',
  WWE: 'Wrestling',
}

export const MATCH_DESCRIPTION_RANGE: DescriptionLengthRange = { min: 80, max: 100 }

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed : null
}

/**
 * Every truthful fragment of the sentence, in the order a reader expects them. A fragment is only
 * offered when the data behind it exists, so the sentence never contains a placeholder.
 *
 * The fixture itself (sport, competition, the two sides) is mandatory; the rest is context that the
 * caller adds only while it brings the sentence closer to the required length.
 */
function buildFragments(input: MatchDescriptionInput): { base: string[]; optional: string[] } {
  const sport = input.sport ? SPORT_LABELS[input.sport.toUpperCase()] ?? null : null
  const competition = clean(input.tournamentName)
  const home = clean(input.homeTeamName)
  const away = clean(input.awayTeamName)
  const kickoff = clean(input.kickoffLabel)
  const quality = clean(input.quality)

  const base: string[] = []
  if (sport && competition) base.push(`${sport} · ${competition}`)
  else if (competition) base.push(competition)
  else if (sport) base.push(`${sport} match`)
  if (home && away) base.push(`${home} vs ${away}`)

  const optional: string[] = []
  if (kickoff) optional.push(`starts ${kickoff}`)
  if (input.durationMinutes !== null && input.durationMinutes !== undefined && Number.isFinite(input.durationMinutes)) {
    optional.push(`about ${input.durationMinutes} minutes of play expected`)
  }
  if (quality) optional.push(`${quality} stream`)
  if (input.round !== null && Number.isFinite(input.round)) optional.push(`round ${input.round}`)
  if (input.preStartWindowMinutes !== null && input.preStartWindowMinutes !== undefined && Number.isFinite(input.preStartWindowMinutes)) {
    optional.push(`coverage opens ${input.preStartWindowMinutes} minutes before`)
  }

  return { base, optional }
}

/** Joins fragments as one sentence, with the separators a reader expects. */
function joinFragments(fragments: string[]): string {
  const [head, ...tail] = fragments
  return tail.length === 0 ? head : `${head}, ${tail.join(', ')}`
}

/**
 * The longest truthful sentence that fits the range.
 *
 * The fixture is always included; context fragments are added one at a time while they still fit and
 * the sentence is still short of the minimum. Nothing is ever trimmed by character, so a word or a
 * clause cannot be cut in half, and a sentence that cannot reach the minimum is refused outright
 * rather than padded.
 */
export function composeMatchDescription(
  input: MatchDescriptionInput,
  range: DescriptionLengthRange = MATCH_DESCRIPTION_RANGE,
): MatchDescriptionResult {
  const { base, optional } = buildFragments(input)
  if (base.length === 0) {
    return {
      description: null,
      warning: 'A match summary could not be written: the competition and the two sides are both unknown.',
    }
  }

  let fragments = [...base]
  for (const fragment of optional) {
    const candidate = joinFragments([...fragments, fragment])
    const check = checkDescriptionLength(candidate, range)
    if (check.reason === 'too-long') continue
    fragments = [...fragments, fragment]
    if (check.inRange) break
  }

  const check = checkDescriptionLength(joinFragments(fragments), range)
  if (check.inRange) return { description: check.text, warning: null }

  return {
    description: null,
    warning: check.reason === 'too-long'
      ? 'A match summary of the required length could not be written: the fixture itself is longer than the limit.'
      : 'A match summary of the required length could not be written from the provided details.',
  }
}
