import type { Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { BadRequestError, ForbiddenError } from '../../core/errors.js'
import { successResponse } from '../../core/api-response.js'
import type { AuthenticatedRequest } from '../../core/middleware/index.js'
import { descriptionRequestSchema, matchParseRequestSchema } from './description.validator.js'
import { generateDescription, parseMatchDetails } from './description.service.js'

export const generateDescriptionController = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const request = descriptionRequestSchema.parse(req.body)
  if (JSON.stringify(request.context).length > 3000) throw new BadRequestError('Description context is too large.')
  const isAdmin = req.user?.roles.some((role) => ['admin', 'super_admin'].includes(role))
  if (request.entityType !== 'REPORT' && !isAdmin) throw new ForbiddenError('Administrator access is required for this description type.')

  const description = await generateDescription(request)
  res.json(successResponse({ description }, 'Description generated successfully.'))
})

export const parseMatchController = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const isMatchManager = req.user?.permissions.includes('admin.matches.manage')
    || req.user?.roles.some((role) => ['admin', 'super_admin'].includes(role))
  if (!isMatchManager) throw new ForbiddenError('Match management permission is required for AI autofill.')

  const request = matchParseRequestSchema.parse(req.body)
  const result = await parseMatchDetails(request)
  res.json(successResponse(result, 'Match details extracted. Review them before saving.'))
})
