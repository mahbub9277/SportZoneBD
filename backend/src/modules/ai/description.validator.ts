import { z } from 'zod'

export const descriptionRequestSchema = z.object({
  entityType: z.enum(['EVENT', 'CHANNEL', 'BANNER', 'SUBSCRIPTION_PLAN', 'ADVERTISEMENT', 'CATEGORY', 'ROLE', 'REPORT', 'POPUP', 'EMAIL_NOTIFICATION', 'PUSH_NOTIFICATION', 'WEBSITE_SETTINGS']),
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(500).optional().default(''),
  context: z.record(z.unknown()).optional().default({}).refine(
    (context) => Object.keys(context).length <= 24,
    'Too many context fields were provided.',
  ),
})

export type DescriptionRequest = z.infer<typeof descriptionRequestSchema>

export const matchParseRequestSchema = z.object({
  input: z.string().trim().min(5, 'Match details are required.').max(2000),
})

export const matchParseResultSchema = z.object({
  title: z.string().trim().max(180).nullable(),
  tournamentName: z.string().trim().max(255).nullable(),
  sport: z.enum(['CRICKET', 'FOOTBALL', 'BASKETBALL', 'TENNIS', 'MOTORSPORTS', 'WWE']).nullable(),
  homeTeamName: z.string().trim().max(80).nullable(),
  awayTeamName: z.string().trim().max(80).nullable(),
  homeTeamLogo: z.string().trim().max(500).nullable(),
  awayTeamLogo: z.string().trim().max(500).nullable(),
  timezone: z.string().trim().max(64),
  kickoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  kickoffTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  expectedDurationMinutes: z.number().int().min(1).max(1440).nullable(),
  autoFinish: z.boolean().nullable(),
  preStartEnabled: z.boolean().nullable(),
  preStartWindowMinutes: z.number().int().min(1).max(1440).nullable(),
  primaryStreamUrl: z.string().url().nullable(),
  quality: z.string().trim().max(32).nullable(),
  confidence: z.record(z.enum(['high', 'medium', 'low'])),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8),
})

export type MatchParseRequest = z.infer<typeof matchParseRequestSchema>
export type MatchParseResult = z.infer<typeof matchParseResultSchema>
