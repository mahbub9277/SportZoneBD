import type { Request, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../../core/prisma.js'
import { successResponse, errorResponse } from '../../core/api-response.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitAdminResourceDeleted } from '../../core/socketManager.js'
import { publicUserSelect } from '../users/user.utils.js'
import { hashPassword } from '../../core/auth.js'
export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    guestMode: z.boolean(),
    isActive: z.boolean(),
    isSuspended: z.boolean(),
    isBanned: z.boolean(),
  })
  .partial()

const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.string().regex(/^[a-zA-Z_]+:(asc|desc)$/).default('createdAt:desc'),
  status: z.string().optional(), // Allow 'all', 'suspended', 'deleted', etc.
});

import { getPaginatedData } from '../../services/pagination.service.js'
import asyncHandler from '../../utils/asyncHandler.js';
import { Prisma } from '@prisma/client';

/**
 * @desc    Get all users with pagination
 * @route   GET /api/v1/admin/users
 * @access  Private (Admin)
 */
export async function listUsers(req: Request, res: Response): Promise<Response> {
  const query = userListQuerySchema.parse(req.query);
  const currentPage = Math.max(1, Number(query.page ?? 1) || 1)
  const itemsPerPage = Math.min(100, Number(query.limit ?? 10) || 10)
  const search = (query.search ?? '').toString().trim()

  const where: Record<string, unknown> = { deletedAt: null, isSuspended: false, isActive: true }
  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { fullName: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      skip: (currentPage - 1) * itemsPerPage,
      take: itemsPerPage,
      orderBy: { createdAt: 'desc' },
      // We need to include roles for the user management page to display them.
      select: {
        ...publicUserSelect,
        roles: {
          select: {
            role: {
              select: { id: true, name: true },
            },
          },
        },
        subscriptions: {
          where: { deletedAt: null },
          orderBy: { expiresAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            expiresAt: true,
            plan: { select: { id: true, name: true, price: true, durationDays: true } },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ])
  return res.json(
    successResponse({
      items,
      meta: {
        totalItems: total,
        itemCount: items.length,
        itemsPerPage,
        totalPages: Math.ceil(total / itemsPerPage),
        currentPage,
      },
    }),
  )
}

export async function createUser(req: Request, res: Response): Promise<Response> {
  const { fullName, email, password, roleIds, isActive } = req.body as {
    fullName?: string
    email?: string
    password?: string
    roleIds?: string[]
    isActive?: boolean
  }

  if (!fullName || !email || !password) {
    return res.status(400).json(errorResponse('Full name, email, and password are required.'))
  }

  try {
    // Check for existing user with this email
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      return res.status(409).json(errorResponse('A user with that email already exists.'))
    }

    // Validate roleIds exist if provided
    if (roleIds && roleIds.length > 0) {
      const rolesCount = await prisma.role.count({
        where: { id: { in: roleIds }, deletedAt: null }
      })
      if (rolesCount !== roleIds.length) {
        return res.status(400).json(errorResponse('One or more role IDs do not exist.'))
      }
    }

    // Use transaction to ensure atomic user + roles creation
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          fullName,
          passwordHash: await hashPassword(password),
          guestMode: false,
          isActive: Boolean(isActive ?? true),
        },
      })

      // Create role assignments if provided
      if (roleIds && roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({
            userId: newUser.id,
            roleId,
          })),
        })
      }

      // Fetch the created user with roles
      return tx.user.findUnique({
        where: { id: newUser.id },
        select: {
          ...publicUserSelect,
          roles: {
            select: {
              role: {
                select: { id: true, name: true },
              },
            },
          },
        },
      })
    })

    if (!user) {
      throw new Error('Failed to create user - unable to retrieve created user')
    }

    await invalidateTags(['user-list', 'recent-users'])
    
    // Emit real-time event to admin clients
    const userData = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isActive: user.isActive,
      roles: user.roles?.map(ur => ({ id: ur.role.id, name: ur.role.name })) || []
    }
    emitAdminResourceCreated('User', user.id, userData)
    
    return res.status(201).json(successResponse(user, 'User created successfully'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('A user with that email already exists.'))
      }
      if (error.code === 'P2025') {
        return res.status(400).json(errorResponse('One or more specified resources not found.'))
      }
    }
    throw error
  }
}

export async function updateUser(req: Request, res: Response): Promise<Response> {
  const { id } = req.params;

  // The validation middleware already ran, so req.body is safe to use.
  const updatableData = req.body
  if (Object.keys(updatableData).length === 0) {
    return res.status(400).json(errorResponse('No updatable fields provided'))
  }

  try {
    const updated = await prisma.user.update({
      where: { id: String(id) },
      data: updatableData,
      select: publicUserSelect,
    })

    // Invalidate the cache for this user
    await invalidateTags([`user:${id}`, 'user-list', 'archived-users', 'recent-users'])
    
    // Emit real-time event to admin clients
    emitAdminResourceUpdated('User', id, {
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      isActive: updated.isActive,
    })
    
    return res.json(successResponse(updated))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('User not found.'))
      }
      if (error.code === 'P2002') {
        // Duplicate field value error
        const field = (error.meta?.target as string[])?.[0] || 'field'
        return res.status(409).json(errorResponse(`A user with that ${field} already exists.`))
      }
    }
    throw error
  }
}

export async function deleteUser(req: Request, res: Response): Promise<Response> {
  const { id } = req.params
  const actorId = (req as Request & { user?: { id?: string } }).user?.id
  if (actorId === String(id)) return res.status(400).json(errorResponse('You cannot delete your own admin account.'))

  try {
    const deleted = await prisma.user.update({
      where: { id: String(id) },
      data: { 
        deletedAt: new Date(), 
        isActive: false,
      },
      select: publicUserSelect,
    })

    // Invalidate all user list caches
    await invalidateTags([`user:${id}`, 'user-list', 'archived-users', 'recent-users'])
    
    // Emit real-time event to admin clients
    emitAdminResourceDeleted('User', id)
    
    return res.json(successResponse(deleted, 'User deleted successfully'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('User not found.'))
      }
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('Failed to delete user due to constraint violation. Please try again.'))
      }
    }
    throw error
  }
}

export async function suspendUser(req: Request, res: Response): Promise<Response> {
  const { id } = req.params;
  const actorId = (req as Request & { user?: { id?: string } }).user?.id
  if (actorId === String(id)) return res.status(400).json(errorResponse('You cannot suspend your own admin account.'))

  const suspendedUser = await prisma.user.update({
    where: { id: String(id) },
    data: {
      isSuspended: true,
      isActive: false, // Suspending should also deactivate the user
    },
    select: publicUserSelect,
  });

  await invalidateTags([`user:${id}`, 'user-list', 'archived-users']);
  return res.json(successResponse(suspendedUser, 'User has been suspended.'));
}

export async function unsuspendUser(req: Request, res: Response): Promise<Response> {
  const { id } = req.params;

  const unsuspendedUser = await prisma.user.update({
    where: { id: String(id), deletedAt: null },
    data: {
      isSuspended: false,
      isActive: true, // Re-activate the user
    },
    select: publicUserSelect,
  });

  await invalidateTags([`user:${id}`, 'user-list', 'archived-users']);
  return res.json(successResponse(unsuspendedUser, 'User has been unsuspended.'));
}

/**
 * @desc    Get all soft-deleted or suspended users
 * @route   GET /api/v1/admin/users/archived
 * @access  Private (Admin)
 */
export const getArchivedUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = userListQuerySchema.parse(req.query);
  const { status, search } = query;

  const whereClause: Prisma.UserWhereInput = {};

  // Base filter for archived users
  if (status === 'suspended') {
    whereClause.AND = [{ isSuspended: true }, { deletedAt: null }];
  } else if (status === 'deleted') {
    whereClause.deletedAt = { not: null };
  } else { // 'all'
    whereClause.OR = [{ deletedAt: { not: null } }, { isSuspended: true }];
  }

  // Combine with search filter if it exists
  if (search) {
    whereClause.AND = [
      ...(Array.isArray(whereClause.AND) ? whereClause.AND : (whereClause.AND ? [whereClause.AND] : [])), // Keep existing AND conditions if any
      {
        OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }],
      },
    ];
  }

  const { items, meta } = await getPaginatedData(
    {
      model: 'user',
      query: { ...query, where: whereClause },
      select: { ...publicUserSelect, deletedAt: true, isSuspended: true, isActive: true },
    });
  res.status(200).json(successResponse({ items, meta }, 'Archived users retrieved successfully'));
});

/**
 * @desc    Restore a soft-deleted or suspended user
 * @route   PATCH /api/v1/admin/users/:id/restore
 * @access  Private (Admin)
 */
export const restoreUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const restoredUser = await prisma.user.update({
    where: { id },
    data: { deletedAt: null, isSuspended: false, isActive: true },
    select: publicUserSelect,
  });
  await invalidateTags([`user:${id}`, 'user-list', 'archived-users', 'recent-users']);
  res.status(200).json(successResponse(restoredUser, 'User restored successfully.'));
});

/**
 * @desc    Permanently delete a user
 * @route   DELETE /api/v1/admin/users/:id/permanent
 * @access  Private (Admin)
 */
export const permanentlyDeleteUser = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  // Note: This is a hard delete. Ensure you have backups or a good reason.
  // You might want to add extra checks here, e.g., only super_admins can do this.
  await prisma.user.delete({
    where: { id },
  });

  // Invalidate all user-related caches
  await invalidateTags(['user-list', 'archived-users', 'recent-users', `user:${id}`]);
  res.status(200).json(successResponse(null, 'User permanently deleted.'));
});

/**
 * @desc    Get all premium users with pagination and filtering
 * @route   GET /api/v1/admin/users/premium
 * @access  Private (Admin)
 */
export const getPremiumUsers = async (req: Request, res: Response) => {
  const query = userListQuerySchema.parse(req.query);
  const now = new Date()

  const { items, meta } = await getPaginatedData({
    model: 'user',
    query: {
      ...query, where: {
        deletedAt: null,
        isActive: true,
        subscriptions: {
          some: {
            deletedAt: null,
            status: 'ACTIVE',
            expiresAt: { gt: now },
          },
        },
      }
    },
    searchableFields: ['fullName', 'email', 'username'],
    select: {
      ...publicUserSelect,
      isActive: true,
      subscriptions: {
        where: { deletedAt: null },
        orderBy: { expiresAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          startedAt: true,
          expiresAt: true,
          plan: { select: { id: true, name: true, price: true, durationDays: true } },
        },
      },
    },
  });
  const normalizedItems = items.map((user: any) => {
    const { subscriptions, ...userData } = user
    const subscription = subscriptions?.[0] ?? null
    return { ...userData, subscription }
  })
  res.status(200).json(successResponse({ items: normalizedItems, meta }, 'Premium users retrieved successfully'));
};
