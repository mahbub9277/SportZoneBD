import type { Request, Response } from 'express'
import { successResponse, errorResponse } from '../../core/api-response.js'
import asyncHandler from '../../utils/asyncHandler.js'
import * as standingsService from './standings.service.js'

export const getStandings = asyncHandler(async (req: Request, res: Response) => {
  const leagueId = typeof req.query.leagueId === 'string' ? req.query.leagueId : undefined
  const rawSeason = typeof req.query.season === 'string' ? req.query.season : undefined
  const season = rawSeason ? standingsService.parseSeasonValue(rawSeason) ?? undefined : undefined

  try {
    const standings = await standingsService.getStandings(leagueId, season)
    res.json(successResponse(standings, 'Standings retrieved successfully'))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to retrieve standings'
    res.status(503).json(errorResponse(message, error))
  }
})
