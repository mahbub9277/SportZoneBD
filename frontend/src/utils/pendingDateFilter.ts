/**
 * Turning the pending-queue controls into the kickoff range the API receives.
 *
 * The admin picks Bangladesh calendar days; the API filters on real instants, so each selected day is
 * expanded to the instants that bound it (see `bangladeshDayRange`). "All upcoming" sends no range at all,
 * and the server keeps its own "not in the past" floor either way.
 */

import { bangladeshDayRange, bangladeshToday, shiftBangladeshDateKey } from './bangladeshDateRange.ts'

export type PendingQuickRange = 'all' | 'today' | 'tomorrow'

export interface PendingDateFilterInput {
  quick: PendingQuickRange
  /** YYYY-MM-DD in Bangladesh time, only used when `quick` is 'all'. */
  from?: string
  to?: string
}

export type PendingDateFilterResult =
  | { ok: true; kickoffFrom: string | null; kickoffTo: string | null }
  | { ok: false; message: string }

export function resolvePendingDateFilter(input: PendingDateFilterInput, now: Date = new Date()): PendingDateFilterResult {
  if (input.quick === 'today' || input.quick === 'tomorrow') {
    const key = input.quick === 'today'
      ? bangladeshToday(now)
      : shiftBangladeshDateKey(bangladeshToday(now), 1)
    const range = key ? bangladeshDayRange(key) : null
    if (!range) return { ok: false, message: 'Could not resolve the selected day.' }
    return { ok: true, kickoffFrom: range.from, kickoffTo: range.to }
  }

  const from = input.from?.trim() ? bangladeshDayRange(input.from) : null
  const to = input.to?.trim() ? bangladeshDayRange(input.to) : null
  if (input.from?.trim() && !from) return { ok: false, message: 'The start date is not a valid date.' }
  if (input.to?.trim() && !to) return { ok: false, message: 'The end date is not a valid date.' }
  if (from && to && to.to <= from.from) return { ok: false, message: 'The end date must be on or after the start date.' }

  return { ok: true, kickoffFrom: from?.from ?? null, kickoffTo: to?.to ?? null }
}

/** Describes the active filter for the result-count line, using the same words as the controls. */
export function describePendingDateFilter(input: PendingDateFilterInput): string {
  if (input.quick === 'today') return 'today'
  if (input.quick === 'tomorrow') return 'tomorrow'
  if (input.from?.trim() && input.to?.trim()) return `${input.from} to ${input.to}`
  if (input.from?.trim()) return `from ${input.from}`
  if (input.to?.trim()) return `until ${input.to}`
  return 'all upcoming'
}
