import { z } from 'zod'

const urlOrEmpty = z.union([z.string().url('A valid URL is required.'), z.literal('')]).optional().nullable()

export const highlightSchema = z.object({
  matchId: z.string().uuid('Invalid Match ID format.').optional().nullable(),
  title: z.string().min(3, 'Title must be at least 3 characters.'),
  url: z.string().url('A valid URL is required.'),
  thumbnail: urlOrEmpty,
  thumbnailUrl: urlOrEmpty,
  duration: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
})