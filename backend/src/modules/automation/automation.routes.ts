import { Router } from 'express'
import { requirePermission, requireRole } from '../../core/middleware/index.js'
import * as automationController from './automation.controller.js'
import {
  getMatchCreationStatus,
  getPushAutomationStatus,
  updateMatchCreationStatus,
  updatePushAutomationStatus,
} from './automationSwitches.controller.js'

const automationRouter = Router()

// Authentication and authorization are enforced by the parent router.
automationRouter.use(requireRole(['admin', 'super_admin']))

automationRouter.get('/status', automationController.getAutomationStatus)
automationRouter.post('/sync', automationController.triggerManualSync)
automationRouter.get('/logs', automationController.getAutomationLogs)
automationRouter.get('/metrics', automationController.getAutomationMetrics)
automationRouter.delete('/logs/:id', automationController.deleteAutomationLog)

// The two master switches. They are operational configuration, so writing them needs the settings
// permission (administrators and super administrators hold it; moderators do not), and the two are
// independent: neither endpoint touches the other setting.
automationRouter.get('/push-notifications', requirePermission('admin.settings.manage'), getPushAutomationStatus)
automationRouter.patch('/push-notifications', requirePermission('admin.settings.manage'), updatePushAutomationStatus)
automationRouter.get('/match-creation', requirePermission('admin.settings.manage'), getMatchCreationStatus)
automationRouter.patch('/match-creation', requirePermission('admin.settings.manage'), updateMatchCreationStatus)

export default automationRouter
