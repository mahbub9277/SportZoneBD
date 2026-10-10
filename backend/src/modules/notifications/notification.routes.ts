import { Router, type RequestHandler } from 'express'
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  broadcastSystemNotification,
  registerPushSubscription,
  unregisterPushSubscription,
  deleteNotification,
  deleteAllNotifications,
} from './notification.controller.js'
import { authenticate, requirePermission } from '../../core/middleware/index.js'
import { campaignLimiter } from '../../middleware/rateLimiter.js'

const notificationsRouter = Router()

// All notification routes should be authenticated
notificationsRouter.use(authenticate)

notificationsRouter.get('/', getNotifications as RequestHandler)
notificationsRouter.get('/unread-count', getUnreadNotificationCount as RequestHandler)
notificationsRouter.post('/push/register', registerPushSubscription as RequestHandler)
notificationsRouter.post('/push/unregister', unregisterPushSubscription as RequestHandler)
notificationsRouter.post('/mark-all-as-read', markAllNotificationsAsRead as RequestHandler)
notificationsRouter.delete('/', deleteAllNotifications as RequestHandler)
// A campaign is a moderation operation: it needs the send permission (administrators hold it) and it is
// rate controlled, so a repeated or accidental mass send is stopped rather than merely discouraged.
notificationsRouter.post('/broadcast', requirePermission('admin.push.send'), campaignLimiter, broadcastSystemNotification as RequestHandler)
notificationsRouter.patch('/:id/mark-as-read', markNotificationAsRead as RequestHandler)
notificationsRouter.delete('/:id', deleteNotification as RequestHandler)

export { notificationsRouter }