import { Router } from 'express'
import { getHighlights, createHighlight, updateHighlight, deleteHighlight } from './highlight.controller.js'
import { authenticate, requireRole } from '../../core/middleware/index.js'
import { cacheMiddleware } from '../../core/middleware/cache.middleware.js'
import { validateBody } from '../../core/validation.js'
import { highlightSchema } from './highlight.validator.js'

const highlightsRouter = Router()

highlightsRouter.route('/')
  .get(cacheMiddleware(300, ['highlights']), getHighlights)
  .post(authenticate, requireRole(['admin', 'super_admin']), validateBody(highlightSchema), createHighlight)

highlightsRouter.route('/:id')
  .patch(authenticate, requireRole(['admin', 'super_admin']), validateBody(highlightSchema.partial()), updateHighlight)
  .delete(authenticate, requireRole(['admin', 'super_admin']), deleteHighlight)

export { highlightsRouter }