import { z } from 'zod'

export const emailTemplateSchema = z.object({
  subject: z.string().min(3, 'Subject must be at least 3 characters long.'),
  body: z.string().min(10, 'Body must be at least 10 characters long.'),
  targetAudience: z.enum(['ALL', 'PREMIUM', 'FREE']).default('ALL'),
  link: z.preprocess((value) => value === '' ? null : value, z.string().refine((value) => value.startsWith('/') || /^https:\/\//i.test(value), 'Link must be an internal path or HTTPS URL.').nullable().optional()),
  enabled: z.boolean().default(true),
})