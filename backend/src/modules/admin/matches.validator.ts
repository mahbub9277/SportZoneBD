import { z } from 'zod'

const truthyStrings = ['true', '1', 'on', 'yes']

export const matchSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters.'),
  tournamentName: z.string().trim().max(255).nullable().optional(),
  homeTeamName: z.string().trim().max(255).nullable().optional(),
  awayTeamName: z.string().trim().max(255).nullable().optional(),
  homeTeamId: z.string().uuid().nullable().optional().or(z.literal('')),
  awayTeamId: z.string().uuid().nullable().optional().or(z.literal('')),
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