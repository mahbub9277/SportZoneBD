import { Router } from 'express'
import { authenticate, requireRole } from '../../core/middleware/index.js'
import { cacheMiddleware } from '../../core/middleware/cache.middleware.js'
import * as controller from './event.controller.js'

const router = Router()
const publicCache = cacheMiddleware(300, ['events', 'event-sidebar'])
const adminOnly = requireRole('admin')

router.get('/sidebar', publicCache, controller.getSidebarEvents)
router.get('/admin/list', authenticate, adminOnly, cacheMiddleware(300, ['events']), controller.getAdminEvents)
router.get('/admin/:id', authenticate, adminOnly, cacheMiddleware(300, ['events']), controller.getAdminEvent)
router.post('/admin', authenticate, adminOnly, controller.createEvent)
router.patch('/admin/reorder', authenticate, adminOnly, controller.reorderEvents)
router.put('/admin/:id', authenticate, adminOnly, controller.updateEvent)
router.delete('/admin/:id', authenticate, adminOnly, controller.deleteEvent)
router.get('/:slug', controller.getEventBySlug)

export { router as eventsRouter }
