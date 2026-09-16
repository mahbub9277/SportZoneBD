import { Router, type RequestHandler } from 'express'
import { authenticate, requireRole } from '../../core/middleware/index.js'
import { createReport, getMyReports, getReportsForAdmin, updateReportStatus } from './report.controller.js'

const reportsRouter = Router()

reportsRouter.post('/', authenticate, createReport as RequestHandler)
reportsRouter.get('/me', authenticate, getMyReports as RequestHandler)
reportsRouter.get('/admin', authenticate, requireRole(['admin', 'super_admin']), getReportsForAdmin as RequestHandler)
reportsRouter.patch('/:id/status', authenticate, requireRole(['admin', 'super_admin']), updateReportStatus as RequestHandler)

export { reportsRouter }
