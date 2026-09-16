import { Router, type Router as ExpressRouter } from 'express'
import { requirePermission, requireRole } from '../../core/middleware/index.js'
import { getDashboardStats, getChartData, getRecentUsers, getAdvertisementAnalytics } from './admin.controller.js'
import { usersRouter } from './users.routes.js'
import { uploadsRouter } from './uploads.routes.js'
import rolesRouter from './roles.routes.js'
import advertisementsRouter from './advertisements.routes.js'
import popupsRouter from './popups.routes.js'
import emailTemplatesRouter from './email.templates.routes.js'
import { adminMatchesRouter } from './admin.matches.routes.js'
import { settingsController } from './settings.controller.js'
import { getAllPayments } from '../payments/payment.controller.js'
import { getPermissions } from './permissions.controller.js'
import { mediaRouter } from './media.routes.js'
import { adminBannersRouter } from '../banners/banner.routes.js'

export const adminRouter: ExpressRouter = Router()

// All routes in this file are automatically prefixed with `/api/v1/admin`.
// Authentication is already applied by the top-level admin route in the main API router.
adminRouter.use(requireRole(['admin', 'super_admin']))

// Dashboard
adminRouter.get('/dashboard/stats', requirePermission('admin.dashboard.view'), getDashboardStats)
adminRouter.get('/dashboard/chart-data', requirePermission('admin.dashboard.view'), getChartData)
adminRouter.get('/dashboard/recent-users', requirePermission('admin.dashboard.view'), getRecentUsers)
adminRouter.get('/dashboard/advertisement-analytics', requirePermission('admin.dashboard.view'), getAdvertisementAnalytics)

// User & Role Management
adminRouter.use('/users', requirePermission('admin.users.manage'), usersRouter)
adminRouter.use('/roles', requirePermission('admin.users.manage'), rolesRouter) // Assuming role management is part of user management
adminRouter.get('/permissions', requirePermission('admin.users.manage'), getPermissions)

// Uploads
adminRouter.use('/uploads', uploadsRouter)
adminRouter.use('/media', mediaRouter)
adminRouter.use('/banners', adminBannersRouter)

// Matches
adminRouter.use('/matches', requirePermission('admin.matches.manage'), adminMatchesRouter)

// Payments
adminRouter.get('/payments', requirePermission('admin.payments.view'), getAllPayments)

// Content Management
adminRouter.use('/advertisements', requirePermission('admin.matches.manage'), advertisementsRouter)
adminRouter.use('/popups', requirePermission('admin.matches.manage'), popupsRouter)
adminRouter.use('/email-templates', requirePermission('admin.matches.manage'), emailTemplatesRouter)

// Settings
adminRouter.get('/settings', requirePermission('admin.settings.manage'), settingsController.getSettings)
adminRouter.patch('/settings', requirePermission('admin.settings.manage'), settingsController.updateSettings)
adminRouter.get('/push-notification-templates', requirePermission('admin.settings.manage'), settingsController.getPushNotificationTemplates)
adminRouter.post('/push-notification-templates', requirePermission('admin.settings.manage'), settingsController.createPushNotificationTemplate)
adminRouter.patch('/push-notification-templates/:id', requirePermission('admin.settings.manage'), settingsController.updatePushNotificationTemplate)
adminRouter.delete('/push-notification-templates/:id', requirePermission('admin.settings.manage'), settingsController.deletePushNotificationTemplate)
