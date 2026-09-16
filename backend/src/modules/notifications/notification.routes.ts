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
import { authenticate, requireRole } from '../../core/middleware/index.js'

const notificationsRouter = Router()

// All notification routes should be authenticated
notificationsRouter.use(authenticate)

notificationsRouter.get('/', getNotifications as RequestHandler)
notificationsRouter.get('/unread-count', getUnreadNotificationCount as RequestHandler)
notificationsRouter.post('/push/register', registerPushSubscription as RequestHandler)
notificationsRouter.post('/push/unregister', unregisterPushSubscription as RequestHandler)
notificationsRouter.post('/mark-all-as-read', markAllNotificationsAsRead as RequestHandler)
notificationsRouter.delete('/', deleteAllNotifications as RequestHandler)
notificationsRouter.post('/broadcast', requireRole(['admin', 'super_admin']), broadcastSystemNotification as RequestHandler)
notificationsRouter.patch('/:id/mark-as-read', markNotificationAsRead as RequestHandler)
notificationsRouter.delete('/:id', deleteNotification as RequestHandler)

export { notificationsRouter }