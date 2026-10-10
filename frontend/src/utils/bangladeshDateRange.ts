/**
 * Bangladesh calendar helpers for the admin review queue.
 *
 * Bangladesh Standard Time is a fixed UTC+6 offset with no daylight saving, so a calendar day can be
 * converted to the exact instants that bound it. That matters for the date filter: a kickoff at 01:00
 * Bangladesh time belongs to that day but to the *previous* UTC date, so comparing date strings would put
 * it in the wrong day and a filter for "Today" would miss it (or show yesterday's evening fixtures).
 */

export const BANGLADESH_OFFSET_MINUTES = 6 * 60
const OFFSET_MS = BANGLADESH_OFFSET_MINUTES * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** The Bangladesh calendar day (YYYY-MM-DD) an instant falls on, or null when the instant is unusable. */
export function bangladeshDateKey(instant: Date | string | number): string | null {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10)
}

export function bangladeshToday(now: Date = new Date()): string {
  return bangladeshDateKey(now) ?? ''
}

/** Moves a Bangladesh date key by whole days, which is how "Tomorrow" is derived. */
export function shiftBangladeshDateKey(dateKey: string, days: number): string | null {
  const trimmed = dateKey.trim()
  if (!isRealDateKey(trimmed)) return null

  const [year, month, day] = trimmed.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10)
  return isRealDateKey(shifted) ? shifted : null
}

function isRealDateKey(dateKey: string): boolean {
  const match = DATE_KEY_PATTERN.exec(dateKey)
  if (!match) return false
  const [, year, month, day] = match
  const base = Date.UTC(Number(year), Number(month) - 1, Number(day))
  return new Date(base).toISOString().slice(0, 10) === dateKey
}

/**
 * The instants that bound one Bangladesh calendar day: from 00:00:00.000 to 23:59:59.999 local, inclusive.
 * Returned as ISO strings because that is what the API and the query string carry.
 */
export function bangladeshDayRange(dateKey: string): { from: string; to: string } | null {
  const trimmed = dateKey.trim()
  const match = DATE_KEY_PATTERN.exec(trimmed)
  if (!match) return null
  if (!isRealDateKey(trimmed)) return null

  const [, year, month, day] = match
  const startMs = Date.UTC(Number(year), Number(month) - 1, Number(day)) - OFFSET_MS
  return { from: new Date(startMs).toISOString(), to: new Date(startMs + DAY_MS - 1).toISOString() }
}
