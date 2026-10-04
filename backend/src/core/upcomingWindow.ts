/**
 * Public "Upcoming" visibility window (RULE 4 / RULE 5).
 *
 * Creating a match row and showing it as Upcoming are deliberately separate concerns: a match may
 * exist in the database long before it becomes visible, and its presence in the database must never
 * imply visibility. Only public listings use this window; admin management endpoints intentionally
 * keep full visibility over every scheduled match.
 */
export const UPCOMING_VISIBILITY_HOURS = 24

export interface UpcomingVisibilityBounds {
  gte: Date
  lte: Date
}

export function getUpcomingVisibilityBounds(now: Date = new Date()): UpcomingVisibilityBounds {
  return {
    gte: now,
    lte: new Date(now.getTime() + UPCOMING_VISIBILITY_HOURS * 60 * 60 * 1000),
  }
}
