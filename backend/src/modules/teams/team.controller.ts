import type { Request, Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse } from '../../core/api-response.js'
import { searchTeams } from './team.service.js'

export const searchTeamsController = asyncHandler(async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q : ''
  res.json(successResponse(await searchTeams(query)))
})
