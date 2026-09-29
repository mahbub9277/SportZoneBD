import { Router } from 'express'
import * as adminMatchesController from './admin.matches.controller.js'
import { transformMatchData } from './matches.middleware.js'
import { validateBody } from '../../core/validation.js'
import { matchSchema } from './matches.validator.js'

const adminMatchesRouter = Router()

// All routes here are already protected by the main admin router
adminMatchesRouter.get('/live', adminMatchesController.getLiveMatches)
adminMatchesRouter.get('/upcoming', adminMatchesController.getUpcomingMatches)
adminMatchesRouter.get('/finished', adminMatchesController.getFinishedMatches)
adminMatchesRouter.post(
  '/',
  transformMatchData,
  validateBody(matchSchema),
  adminMatchesController.createMatch,
)
adminMatchesRouter.patch(
  '/:id',
  transformMatchData,
  validateBody(matchSchema.partial()), // Use .partial() for updates
  adminMatchesController.updateMatch,
)
adminMatchesRouter.patch('/:id/status', adminMatchesController.updateMatchStatus)
adminMatchesRouter.patch('/:id/extend', adminMatchesController.extendMatch)
adminMatchesRouter.delete('/:id', adminMatchesController.deleteMatch)

export { adminMatchesRouter }