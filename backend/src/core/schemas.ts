import { z } from 'zod';

/**
 * Base Zod schema for the News model.
 * Reflects the structure and types defined in `prisma/schema.prisma`.
 */
export const newsSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  summary: z.string(),
  content: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  category: z.string(),
  publishedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable().optional(),
});

/**
 * Zod schema for creating a new News article.
 * Omits auto-generated fields like `id`, `publishedAt`, etc.
 */
export const createNewsSchema = newsSchema.omit({
  id: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

/**
 * Base Zod schema for the User model.
 * Reflects the structure and types defined in `prisma/schema.prisma`.
 * Sensitive fields like `passwordHash` are included but should be handled with care.
 */
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable().optional(),
  username: z.string().nullable().optional(),
  fullName: z.string(),
  avatar: z.string().url().nullable().optional(),
  passwordHash: z.string().nullable().optional(),
  googleId: z.string().nullable().optional(),
  guestMode: z.boolean(),
  isActive: z.boolean(),
  isSuspended: z.boolean(),
  isBanned: z.boolean(),
  lastLoginAt: z.date().nullable().optional(),
  generations: z.number().int(),
  emailVerifiedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable().optional(),
});

/**
 * Zod schema for creating a new User.
 * Omits auto-generated and sensitive fields.
 * Includes `password` for creation validation.
 */
export const createUserSchema = userSchema.pick({
    email: true,
    fullName: true,
    username: true,
}).extend({
    password: z.string().min(8, 'Password must be at least 8 characters long'),
});

/**
 * Zod schema for updating a User.
 * Makes all fields optional for partial updates.
 */
export const updateUserSchema = userSchema.pick({
    email: true,
    fullName: true,
    username: true,
    avatar: true,
    isActive: true,
    isSuspended: true,
    isBanned: true,
}).partial();