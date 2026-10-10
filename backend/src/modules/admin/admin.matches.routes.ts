import { Router } from 'express'
import * as adminMatchesController from './admin.matches.controller.js'
import { transformMatchData } from './matches.middleware.js'
import { validateBody } from '../../core/validation.js'
import { matchSchema, bulkReviewSchema } from './matches.validator.js'

const adminMatchesRouter = Router()

// All routes here are already protected by the main admin router
adminMatchesRouter.get('/live', adminMatchesController.getLiveMatches)
adminMatchesRouter.get('/upcoming', adminMatchesController.getUpcomingMatches)
adminMatchesRouter.get('/finished', adminMatchesController.getFinishedMatches)
// Registered before the parameterised PATCH routes for clarity; there is no GET '/:id' on this router.
adminMatchesRouter.get('/pending', adminMatchesController.getPendingMatches)
// Bulk review of the pending queue. The ids are validated and capped, and both endpoints run the same
// conditional updates the single-row accept/reject run.
adminMatchesRouter.post(
  '/pending/bulk-accept',
  validateBody(bulkReviewSchema),
  adminMatchesController.bulkAcceptPendingMatches,
)
adminMatchesRouter.post(
  '/pending/bulk-reject',
  validateBody(bulkReviewSchema),
  adminMatchesController.bulkRejectPendingMatches,
)
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
adminMatchesRouter.patch('/:id/accept', adminMatchesController.acceptPendingMatch)
adminMatchesRouter.patch('/:id/reject', adminMatchesController.rejectPendingMatch)
adminMatchesRouter.patch('/:id/extend', adminMatchesController.extendMatch)
adminMatchesRouter.delete('/:id', adminMatchesController.deleteMatch)

export { adminMatchesRouter }