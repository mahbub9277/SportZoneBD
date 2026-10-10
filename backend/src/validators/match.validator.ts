import { z } from 'zod'

export const createMatchSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2, 'Match title must be at least 2 characters.'),
    /** Optional season label supplied by an admin (for example "2026/2027"). */
    season: z.string().trim().max(32).nullable().optional(),
    /** Optional league round/matchday supplied by an admin (for example 8). An empty value means "not stated". */
    round: z.preprocess(
      (val) => val === '' || val === null || val === undefined ? null : Number(val),
      z.coerce.number().int().min(1).max(200).nullable().optional(),
    ),
    kickoffAt: z.coerce.date({ invalid_type_error: 'kickoffAt must be a valid date string' }),
    status: z.enum(['UPCOMING', 'LIVE', 'FINISHED']).optional(),
    premium: z.preprocess((val) => {
      if (typeof val === 'string') {
        return val === 'true'
      }
      return val
    }, z.boolean().optional()),
    stadium: z.string().trim().optional().nullable(),
    streams: z.string().optional(),
  }),
})

export const updateMatchSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid match ID'),
  }),
  body: createMatchSchema.shape.body.partial(),
})
