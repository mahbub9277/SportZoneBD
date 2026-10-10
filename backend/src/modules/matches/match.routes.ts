import { Router, type Router as ExpressRouter } from 'express'
import { createMatchSchema, updateMatchSchema } from '../../validators/match.validator.js'
import { createMatch, deleteMatch, getAllMatches, getMatchById, softDeleteMatch, updateMatch } from '../../controllers/matchController.js'
import { authenticate, requirePermission } from '../../core/middleware/index.js'
import { validateBody } from '../../core/middleware/index.js'
import { cacheMiddleware } from '../../core/middleware/cache.middleware.js'

const matchRouter: ExpressRouter = Router()

const canManageMatches = requirePermission('admin.matches.manage')

// Cache GET endpoints for 5 minutes (300 seconds)
matchRouter.get('/', cacheMiddleware(300, ['matches']), getAllMatches)

matchRouter.post('/', authenticate, canManageMatches, validateBody(createMatchSchema.shape.body), createMatch)

matchRouter
  .route('/:id')
  .get(getMatchById)
  .patch(authenticate, canManageMatches, validateBody(updateMatchSchema.shape.body), updateMatch)
  .delete(authenticate, canManageMatches, deleteMatch)

matchRouter.delete('/:id/soft', authenticate, canManageMatches, softDeleteMatch)

export default matchRouter
