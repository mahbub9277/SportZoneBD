import type { Request, Response } from 'express'
import { successResponse } from '../../core/api-response.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { getStandings as getLeagueStandings } from './footballDataStandings.service.js'
import { attachAssignedTeamLogos } from './standingsTeamLogos.js'

export const getStandings = asyncHandler(async (req: Request, res: Response) => {
  const standings = await getLeagueStandings(req.query.leagueCode)
  // The admin-managed logo is attached after the cached provider payload, so an override shows immediately.
  const standingsWithLogos = await attachAssignedTeamLogos(standings)
  res.json(successResponse(standingsWithLogos, 'Standings retrieved successfully'))
})
