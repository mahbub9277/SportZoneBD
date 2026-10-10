import { Router } from 'express'
import { authenticate, optionalProtect, requirePermission } from '../../core/middleware/index.js'
import * as controller from './channel.controller.js'
import { cacheMiddleware } from '../../core/middleware/cache.middleware.js'

const router = Router()

// Cache for public GET endpoints (5 minutes)
const publicCacheMiddleware = cacheMiddleware(300, ['channels', 'channel-data'])

// --- Public Routes ---
router.get('/', publicCacheMiddleware, controller.getPublicChannels)
router.get('/by-ids', publicCacheMiddleware, controller.getChannelsByIds) // New public route to get multiple channels by IDs

// --- Admin Routes ---
const adminOnly = requirePermission('admin.channels.manage')

// Category Management
router.post('/categories', authenticate, adminOnly, controller.createCategory)
router.get('/categories/all', authenticate, adminOnly, cacheMiddleware(600, ['channel-categories']), controller.getAdminCategories) // Moved up
router.put('/categories/:id', authenticate, adminOnly, controller.updateCategory)
router.delete('/categories/:id', authenticate, adminOnly, controller.deleteCategory)

// Channel Management
router.get('/all', authenticate, adminOnly, cacheMiddleware(300, ['channels']), controller.getAdminChannels) // Moved up
router.post('/', authenticate, adminOnly, controller.createChannel)

// --- Dynamic/Parameterized Routes (Public and Admin) ---
// Viewer counts come from live Redis presence and must never be cached.
router.get('/watch/:id', controller.getWatchChannelData)
router.get('/:id/reactions', optionalProtect, controller.getChannelReactions)
router.post('/:id/reactions', authenticate, controller.toggleChannelReaction)
router.post('/:id/viewers/enter', controller.enterChannelViewer)
router.post('/:id/viewers/leave', controller.leaveChannelViewer)
router.get('/:id/related', publicCacheMiddleware, controller.getRelatedChannels)
router.get('/admin/:id', authenticate, adminOnly, cacheMiddleware(300, ['channels']), controller.getChannelById)
router.get('/:id', publicCacheMiddleware, controller.getChannelById) // Public get by ID should be after more specific routes
router.put('/:id', authenticate, adminOnly, controller.updateChannel)
router.delete('/:id', authenticate, adminOnly, controller.deleteChannel)

export { router as channelsRouter }