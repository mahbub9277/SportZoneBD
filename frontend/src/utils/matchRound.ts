/**
 * The round an admin typed into the create/edit match form.
 *
 * The field is optional, so an empty box means "not stated" and must reach the API as `null` rather than
 * as `0` or an empty string: a round is a real matchday number, and the match card only renders it when
 * the value is a genuine positive integer. Anything that is not a whole number in range is treated as not
 * stated, so a typo can never become a fabricated round on a public match card.
 */
export const MIN_MATCH_ROUND = 1
export const MAX_MATCH_ROUND = 200

export function parseMatchRound(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && !value.trim()) return null

  const round = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(round)) return null
  if (round < MIN_MATCH_ROUND || round > MAX_MATCH_ROUND) return null
  return round
}
