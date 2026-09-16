import { z } from 'zod';

const validSortFields = ['name', 'country', 'createdAt'];

export const getAllTeamsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().optional(),
    sortBy: z.string().optional().default('name:asc').refine(
      (val) => {
        if (!val) return true;
        const [field, order] = val.split(':');
        return validSortFields.includes(field) && ['asc', 'desc'].includes(order);
      },
      { message: 'Invalid sort parameter. Use format: field:(asc|desc)' }
    ),
  }),
});

export const createTeamSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Team name must be at least 2 characters.'),
    shortName: z.string().trim().optional().nullable(),
    logo: z.string().url('Invalid URL for logo.').optional().nullable(),
    country: z.string().trim().optional().nullable(),
  }),
});

export const getTeamSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid team ID'),
  }),
});

export const updateTeamSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid team ID'),
  }),
  body: createTeamSchema.shape.body.partial(), // Re-use the create schema and make all fields optional
});