import { z } from 'zod';

const validSortFields = ['name', 'position', 'number', 'createdAt'] as const;

const parseSortBy = (value?: string | null) => {
  if (!value) return null;

  const trimmed = value.trim();
  const [field, order] = trimmed.split(':');

  if (!field || !order) return null;
  if (!validSortFields.includes(field as (typeof validSortFields)[number])) return null;
  if (!['asc', 'desc'].includes(order)) return null;

  return { field, order };
};

export const getAllPlayersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().optional(),
    sortBy: z
      .string()
      .optional()
      .default('createdAt:desc')
      .refine((val) => parseSortBy(val) !== null, {
        message: 'Invalid sort parameter. Use format: field:(asc|desc)',
      }),
  }),
});

export const getPlayerSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid player ID'),
  }),
});

export const createPlayerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Player name must be at least 2 characters.'),
    number: z.coerce.number().int().optional().nullable(),
    position: z.string().trim().optional().nullable(),
    teamId: z.string().uuid('Invalid team ID.').optional().nullable(),
    // You can add more fields here like country, photoUrl etc.
  }),
});

export const updatePlayerSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid player ID'),
  }),
  body: createPlayerSchema.shape.body.partial(), // Re-use the create schema and make all fields optional
});