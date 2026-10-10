/**
 * The Pending Matches review queue filter.
 *
 * A pending match is a review request for a fixture that is still to come, so the queue only ever contains
 * fixtures whose kickoff is in the future. Rows whose kickoff has already gone by — inserted before this
 * rule existed, or by a sync that ran after the match started — stay in the database (they are the audit
 * trail, and the row keeps its unique provider key so discovery cannot recreate it) but they are not a
 * review request any more, so the API never lists them. The filter is applied in the query rather than in
 * the admin UI, so no client can show or act on a stale row.
 *
 * The optional range narrows the queue further, and it is intersected with the future floor rather than
 * replacing it: a range that starts in the past can never re-expose an expired row.
 */

export interface PendingMatchFilter {
  status: 'PENDING'
  deletedAt: null
  kickoffAt: { gt: Date; lte?: Date }
}

export interface PendingMatchRange {
  /** Start of the applied kickoff range, already clamped to "not in the past". */
  from: Date
  /** End of the applied kickoff range, inclusive; null when every upcoming fixture is in scope. */
  to: Date | null
}

export function buildPendingMatchFilter(now: Date = new Date(), range: { from?: Date | null; to?: Date | null } = {}): PendingMatchFilter {
  const requestedFrom = range.from ?? null
  const from = requestedFrom && requestedFrom.getTime() > now.getTime() ? requestedFrom : now
  return {
    status: 'PENDING',
    deletedAt: null,
    kickoffAt: range.to ? { gt: from, lte: range.to } : { gt: from },
  }
}

export type PendingMatchFilterParseResult =
  | { ok: true; filter: PendingMatchFilter; range: PendingMatchRange }
  | { ok: false; message: string }

const parseInstant = (value: unknown): Date | null | undefined => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = new Date(value.trim())
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/**
 * Turns the admin query parameters into the database filter.
 *
 * The instants themselves are resolved by the client (the admin UI knows the Bangladesh calendar day it is
 * filtering on), so this only has to reject what cannot be a real range: a malformed instant, or an end
 * that does not come after the start. The timezone boundary is therefore crossed with real timestamps
 * rather than by comparing date strings.
 */
export function parsePendingMatchFilters(
  query: { kickoffFrom?: unknown; kickoffTo?: unknown },
  now: Date = new Date(),
): PendingMatchFilterParseResult {
  const from = parseInstant(query.kickoffFrom)
  const to = parseInstant(query.kickoffTo)

  if (from === undefined || to === undefined) return { ok: false, message: 'Invalid date filter.' }
  if (from && to && to.getTime() <= from.getTime()) return { ok: false, message: 'The end date must be after the start date.' }

  const filter = buildPendingMatchFilter(now, { from, to })
  // The reported range is the one really applied, so a range that started in the past is echoed clamped.
  return { ok: true, filter, range: { from: filter.kickoffAt.gt, to } }
}

