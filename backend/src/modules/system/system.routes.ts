import { Router } from 'express'
import {
  getSystemLogs,
  getAuditLogs,
  getActivityLogs,
  getSystemBackups,
  createBackup,
  getCloudinaryStorageUsage,
  downloadBackup,
} from './system.controller.js'

const systemRouter = Router()

systemRouter.get('/logs', getSystemLogs)
systemRouter.get('/logs/audit', getAuditLogs)
systemRouter.get('/logs/activity', getActivityLogs)

systemRouter.get('/backups', getSystemBackups)
systemRouter.post('/backups', createBackup)
systemRouter.get('/backups/:id/download', downloadBackup)

systemRouter.get('/storage-usage', getCloudinaryStorageUsage)

export { systemRouter }