import type { Request, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse, errorResponse } from '../../core/api-response.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitAdminResourceDeleted } from '../../core/socketManager.js'

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters.'),
  description: z.string().trim().optional().or(z.literal('')).transform((value) => (value ? value : null)),
})

const getRoles = asyncHandler(async (_req: Request, res: Response) => {
  const roles = await prisma.role.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, description: true },
  })
  res.status(200).json(successResponse(roles))
})

const createRole = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = roleSchema.parse(req.body)

    const existingRole = await prisma.role.findFirst({
      where: { name: validatedData.name, deletedAt: null }, // Ensure we don't conflict with soft-deleted roles
    })

    if (existingRole) {
      return res.status(409).json(errorResponse('A role with this name already exists.'))
    }

    const role = await prisma.role.create({
      data: {
        name: validatedData.name,
        description: validatedData.description ?? null,
      },
    })

    await invalidateTags(['roles'])
    
    // Emit real-time event to admin clients
    emitAdminResourceCreated('Role', role.id, {
      id: role.id,
      name: role.name
    })

    res.status(201).json(successResponse(role, 'Role created successfully'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('A role with this name already exists.'))
      }
    }
    throw error
  }
})

/**
 * @desc    Get a simple list of all roles (for UI selectors)
 * @route   GET /api/v1/admin/roles/list
 * @access  Private (Admin)
 */
const getRoleList = asyncHandler(async (req: Request, res: Response) => {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.status(200).json(successResponse(roles, 'Roles list retrieved successfully'));
});

const updateRole = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const validatedData = roleSchema.partial().parse(req.body)

    const existingRole = await prisma.role.findFirst({
      where: { id, deletedAt: null },
      select: { id: true }
    })

    if (!existingRole) {
      return res.status(404).json(errorResponse('Role not found.'))
    }

    const role = await prisma.role.update({
      where: { id },
      data: validatedData,
      select: { id: true, name: true, description: true }
    })

    await invalidateTags(['roles', `role:${id}`])
    
    // Emit real-time event to admin clients
    emitAdminResourceUpdated('Role', id, {
      id: role.id,
      name: role.name
    })

    res.status(200).json(successResponse(role, 'Role updated successfully'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('Role not found.'))
      }
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('A role with this name already exists.'))
      }
    }
    throw error
  }
})

const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const role = await prisma.role.findFirst({
      where: { id, deletedAt: null },
      select: { id: true }
    })

    if (!role) {
      return res.status(404).json(errorResponse('Role not found.'))
    }

    // Soft delete the role
    const deletedRole = await prisma.role.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true }
    })

    await invalidateTags(['roles'])
    
    // Emit real-time event to admin clients
    emitAdminResourceDeleted('Role', id)

    res.status(200).json(successResponse(deletedRole, 'Role deleted successfully'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('Role not found.'))
      }
    }
    throw error
  }
})

export const rolesController = {
  getRoles,
  createRole,
  getRoleList,
  updateRole,
  deleteRole,
}