import { Router } from 'express'
import { authenticate, requireRole } from '../../core/middleware/index.js'
import * as automationController from './automation.controller.js'

const automationRouter = Router()

// Authentication and authorization are enforced by the parent router.
automationRouter.use(requireRole(['admin', 'super_admin']))

automationRouter.get('/status', automationController.getAutomationStatus)
automationRouter.post('/sync', automationController.triggerManualSync)
automationRouter.get('/logs', automationController.getAutomationLogs)
automationRouter.get('/metrics', automationController.getAutomationMetrics)
automationRouter.delete('/logs/:id', automationController.deleteAutomationLog)

export default automationRouter
