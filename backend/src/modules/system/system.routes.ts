import { Router } from 'express'
import {
  getSystemLogs,
  getAuditLogs,
  getActivityLogs,
  getCloudinaryStorageUsage,
} from './system.controller.js'

const systemRouter = Router()

systemRouter.get('/logs', getSystemLogs)
systemRouter.get('/logs/audit', getAuditLogs)
systemRouter.get('/logs/activity', getActivityLogs)

systemRouter.get('/storage-usage', getCloudinaryStorageUsage)

export { systemRouter }