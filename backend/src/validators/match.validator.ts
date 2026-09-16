import { z } from 'zod'

export const createMatchSchema = z.object({
  body: z.object({
    title: z.string().trim().min(2, 'Match title must be at least 2 characters.'),
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
