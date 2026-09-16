import { Router } from 'express'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  updateMyProfile,
} from './settings.controller.js'
import type { RequestHandler } from 'express'

const settingsRouter = Router()

// The base path /settings is already authenticated in the main router
settingsRouter.get('/notification-preferences', getNotificationPreferences as RequestHandler)
settingsRouter.patch('/notification-preferences', updateNotificationPreferences as RequestHandler)
settingsRouter.patch('/profile', updateMyProfile as RequestHandler)

export { settingsRouter }
