import type { Request, Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse } from '../../core/api-response.js'

export const getPermissions = asyncHandler(async (_req: Request, res: Response) => {
  const permissions = await prisma.permission.findMany({
    select: { id: true, key: true, description: true },
    orderBy: { key: 'asc' },
  })
  res.status(200).json(successResponse(permissions, 'Permissions retrieved successfully'))
})
