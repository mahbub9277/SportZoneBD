import { Router, type RequestHandler } from 'express'
import { authenticate, requirePermission } from '../../core/middleware/index.js'
import { createReport, getMyReports, getReportDetail, getReportsForAdmin, updateReportStatus } from './report.controller.js'

const reportsRouter = Router()

// Anyone signed in may report a problem and read their own reports.
reportsRouter.post('/', authenticate, createReport as RequestHandler)
reportsRouter.get('/me', authenticate, getMyReports as RequestHandler)

// The moderation queue. Gated by the same permission the console navigation uses, so a moderator who can
// see the queue is exactly the moderator the backend lets read, open and move reports. The actor of every
// recorded action is taken from the authenticated session, never from the request body.
reportsRouter.get('/admin', authenticate, requirePermission('admin.reports.manage'), getReportsForAdmin as RequestHandler)
reportsRouter.get('/admin/:id', authenticate, requirePermission('admin.reports.manage'), getReportDetail as RequestHandler)
reportsRouter.patch('/:id/status', authenticate, requirePermission('admin.reports.manage'), updateReportStatus as RequestHandler)

export { reportsRouter }
