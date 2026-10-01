import type { Request, Response } from 'express'
import { successResponse } from '../../core/api-response.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { getStandings as getLeagueStandings } from './footballDataStandings.service.js'

export const getStandings = asyncHandler(async (req: Request, res: Response) => {
  const standings = await getLeagueStandings(req.query.leagueCode)
  res.json(successResponse(standings, 'Standings retrieved successfully'))
})
