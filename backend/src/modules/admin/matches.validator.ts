import { z } from 'zod'
import { MAX_BULK_REVIEW_IDS } from './pendingMatchReview.js'

const truthyStrings = ['true', '1', 'on', 'yes']

export const matchSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters.'),
  tournamentName: z.string().trim().max(255).nullable().optional(),
  /** Season label as the competition states it (for example "2026/2027"); optional and never invented. */
  season: z.string().trim().max(32).nullable().optional(),
  /** League round/matchday as a number; empty means "not stated" and is stored as null, never as 0. */
  round: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number({ invalid_type_error: 'Round must be a number.' }).int().min(1).max(200).nullable().optional(),
  ),
  homeTeamName: z.string().trim().max(255).nullable().optional(),
  awayTeamName: z.string().trim().max(255).nullable().optional(),
  homeTeamId: z.string().uuid().nullable().optional().or(z.literal('')),
  awayTeamId: z.string().uuid().nullable().optional().or(z.literal('')),
  homeTeamLogo: z.string().url().nullable().optional().or(z.literal('')),
  awayTeamLogo: z.string().url().nullable().optional().or(z.literal('')),
  kickoffAt: z.coerce.date(),
  expectedEndTime: z.preprocess((val) => val === '' || val === null || val === undefined ? undefined : val, z.coerce.date().optional()),
  autoFinish: z.preprocess((val) => {
    if (typeof val === 'string') return truthyStrings.includes(val.toLowerCase())
    return val
  }, z.boolean()).default(false),
  preStartEnabled: z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return null
    if (typeof val === 'string') return truthyStrings.includes(val.toLowerCase())
    return val
  }, z.boolean().nullable().optional()),
  preStartWindowMinutes: z.preprocess((val) => val === '' || val === null || val === undefined ? null : Number(val), z.number().int().min(1).max(1440).nullable().optional()),
  preStartVideoUrl: z.preprocess((val) => typeof val === 'string' && !val.trim() ? null : val, z.string().url().nullable().optional()),
  sport: z.enum(['CRICKET', 'FOOTBALL', 'BASKETBALL', 'TENNIS', 'MOTORSPORTS', 'WWE']).optional(),
  status: z.enum(['UPCOMING', 'LIVE', 'FINISHED']).optional(),
  premium: z.preprocess((val) => {
    if (typeof val === 'string') return truthyStrings.includes(val.toLowerCase())
    return val
  }, z.boolean()).default(false),
  streams: z.string().optional(),
})

/** The ids a bulk review may carry, deduplicated by the controller before use. */
export const bulkReviewSchema = z.object({
  ids: z.array(z.string().uuid('Every id must be a match id.')).min(1, 'Select at least one match.').max(MAX_BULK_REVIEW_IDS),
})