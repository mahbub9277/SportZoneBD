import { Router, type Router as ExpressRouter } from 'express'
import { requirePermission, requireRole } from '../../core/middleware/index.js'
import { getDashboardStats, getChartData, getRecentUsers, getAdvertisementAnalytics } from './admin.controller.js'
import { usersRouter } from './users.routes.js'
import { uploadsRouter } from './uploads.routes.js'
import rolesRouter from './roles.routes.js'
import advertisementsRouter from './advertisements.routes.js'
import popupsRouter from './popups.routes.js'
import emailTemplatesRouter from './email.templates.routes.js'
import { emailTemplatesController } from './email.templates.controller.js'
import { adminMatchesRouter } from './admin.matches.routes.js'
import { settingsController } from './settings.controller.js'
import { getAllPayments } from '../payments/payment.controller.js'
import { getPermissions } from './permissions.controller.js'
import { mediaRouter } from './media.routes.js'
import { adminBannersRouter } from '../banners/banner.routes.js'
import {
  getModerationActivity,
  getModerationAuditOptions,
  getModerationSessions,
  getModerationSummary,
  getPushAudiencePreview,
} from './moderation.controller.js'
import { campaignLimiter } from '../../middleware/rateLimiter.js'

export const adminRouter: ExpressRouter = Router()

// All routes in this file are automatically prefixed with `/api/v1/admin`.
// Authentication is already applied by the top-level admin route in the main API router.
// Moderators are admitted here only because every route below decides for itself which permission it
// needs; a moderator without that permission is rejected by `requirePermission` further down.
adminRouter.use(requireRole(['admin', 'super_admin', 'moderator']))

// Dashboard
adminRouter.get('/dashboard/stats', requirePermission('admin.dashboard.view'), getDashboardStats)
adminRouter.get('/dashboard/chart-data', requirePermission('admin.dashboard.view'), getChartData)
adminRouter.get('/dashboard/recent-users', requirePermission('admin.dashboard.view'), getRecentUsers)
adminRouter.get('/dashboard/advertisement-analytics', requirePermission('admin.dashboard.view'), getAdvertisementAnalytics)

// User & Role Management
adminRouter.use('/users', requirePermission('admin.users.manage'), usersRouter)
adminRouter.use('/roles', requirePermission('admin.users.manage'), rolesRouter) // Assuming role management is part of user management
adminRouter.get('/permissions', requirePermission('admin.users.manage'), getPermissions)

// Uploads & Media
adminRouter.use('/uploads', uploadsRouter)
adminRouter.use('/media', requirePermission('admin.media.manage'), mediaRouter)
adminRouter.use('/banners', adminBannersRouter)

// Matches
adminRouter.use('/matches', requirePermission('admin.matches.manage'), adminMatchesRouter)

// Payments
adminRouter.get('/payments', requirePermission('admin.payments.view'), getAllPayments)

// Moderation operations: the activity/history view, the summary the moderator dashboard is built from,
// session activity, the audit filter vocabulary, and the audience preview a campaign is confirmed against.
adminRouter.get('/moderation/summary', requirePermission('admin.activity.view'), getModerationSummary)
adminRouter.get('/moderation/activity', requirePermission('admin.activity.view'), getModerationActivity)
adminRouter.get('/moderation/sessions', requirePermission('admin.activity.view'), getModerationSessions)
adminRouter.get('/moderation/audit-options', requirePermission('admin.activity.view'), getModerationAuditOptions)
adminRouter.get('/moderation/push-audience', requirePermission('admin.push.send'), getPushAudiencePreview)

// Email campaigns. Sending is a moderation operation, so it is gated by its own permission while the
// templates themselves stay under content management; both routes are registered before the content-gated
// router below, so an administrator uses the same URLs with exactly the access they had.
adminRouter.get('/email-templates/sendable', requirePermission('admin.email.send'), emailTemplatesController.getSendableEmailTemplates)
adminRouter.get('/email-templates/campaign-audiences', requirePermission('admin.email.send'), emailTemplatesController.getEmailCampaignAudiences)
adminRouter.post('/email-templates/:id/send', requirePermission('admin.email.send'), campaignLimiter, emailTemplatesController.sendEmailTemplate)

// Content Management. Split out of `admin.matches.manage` so match moderators do not inherit
// authority over advertisements, popups and email templates.
adminRouter.use('/advertisements', requirePermission('admin.content.manage'), advertisementsRouter)
adminRouter.use('/popups', requirePermission('admin.content.manage'), popupsRouter)
adminRouter.use('/email-templates', requirePermission('admin.content.manage'), emailTemplatesRouter)

// Settings
adminRouter.get('/settings', requirePermission('admin.settings.manage'), settingsController.getSettings)
adminRouter.patch('/settings', requirePermission('admin.settings.manage'), settingsController.updateSettings)
adminRouter.get('/push-notification-templates', requirePermission('admin.settings.manage'), settingsController.getPushNotificationTemplates)
adminRouter.post('/push-notification-templates', requirePermission('admin.settings.manage'), settingsController.createPushNotificationTemplate)
adminRouter.patch('/push-notification-templates/:id', requirePermission('admin.settings.manage'), settingsController.updatePushNotificationTemplate)
adminRouter.delete('/push-notification-templates/:id', requirePermission('admin.settings.manage'), settingsController.deletePushNotificationTemplate)
