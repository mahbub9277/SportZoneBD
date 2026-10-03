import { Router } from 'express'
import { successResponse } from '../../core/api-response.js'
import { getStandingsCompetitions } from './footballDataStandings.service.js'
import { getStandings } from './standings.controller.js'

const standingsRouter = Router()

standingsRouter.get('/competitions', (_req, res) => {
	res.json(successResponse(getStandingsCompetitions(), 'Standings competitions retrieved successfully'))
})
standingsRouter.get('/', getStandings)

export { standingsRouter }
