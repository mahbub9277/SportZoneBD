import { Router } from 'express'
import * as adminMatchesController from './admin.matches.controller.js'
import { upload } from '../../middleware/upload.js'
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
  upload.fields([
    { name: 'homeTeamLogo', maxCount: 1 },
    { name: 'awayTeamLogo', maxCount: 1 },
  ]),
  transformMatchData,
  validateBody(matchSchema),
  adminMatchesController.createMatch,
)
adminMatchesRouter.patch(
  '/:id',
  upload.fields([
    { name: 'homeTeamLogo', maxCount: 1 },
    { name: 'awayTeamLogo', maxCount: 1 },
  ]),
  transformMatchData,
  validateBody(matchSchema.partial()), // Use .partial() for updates
  adminMatchesController.updateMatch,
)
adminMatchesRouter.patch('/:id/status', adminMatchesController.updateMatchStatus)
adminMatchesRouter.patch('/:id/extend', adminMatchesController.extendMatch)
adminMatchesRouter.delete('/:id', adminMatchesController.deleteMatch)

export { adminMatchesRouter }