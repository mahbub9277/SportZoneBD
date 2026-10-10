import { Router } from 'express'
import { getHighlights, createHighlight, updateHighlight, deleteHighlight, incrementHighlightView } from './highlight.controller.js'
import { authenticate, requirePermission } from '../../core/middleware/index.js'
import { cacheMiddleware } from '../../core/middleware/cache.middleware.js'
import { validateBody } from '../../core/validation.js'
import { highlightSchema } from './highlight.validator.js'

const highlightsRouter = Router()

const canManageHighlights = requirePermission('admin.highlights.manage')

highlightsRouter.route('/')
  .get(cacheMiddleware(300, ['highlights']), getHighlights)
  .post(authenticate, canManageHighlights, validateBody(highlightSchema), createHighlight)

highlightsRouter.route('/:id')
  .patch(authenticate, canManageHighlights, validateBody(highlightSchema.partial()), updateHighlight)
  .delete(authenticate, canManageHighlights, deleteHighlight)

// Public: one intentional highlight open = one increment.
highlightsRouter.post('/:id/view', incrementHighlightView)

export { highlightsRouter }