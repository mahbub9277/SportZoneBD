import { Router } from 'express'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  updateMyProfile,
} from './settings.controller.js'
import { getPublicSiteSettings } from './site-settings.js'
import type { RequestHandler } from 'express'

const settingsRouter = Router()

// Publicly readable, visitor-safe site settings. The main router leaves this one path unauthenticated.
settingsRouter.get('/public', getPublicSiteSettings as RequestHandler)

// The base path /settings is already authenticated in the main router
settingsRouter.get('/notification-preferences', getNotificationPreferences as RequestHandler)
settingsRouter.patch('/notification-preferences', updateNotificationPreferences as RequestHandler)
settingsRouter.patch('/profile', updateMyProfile as RequestHandler)

export { settingsRouter }
