import { Router } from 'express'
import { authenticate, requireRole } from '../../core/middleware/index.js'
import { uploadsController } from './uploads.controller.js'
import { uploadLimiter } from '../../middleware/rateLimiter.js'

const uploadsRouter = Router()

uploadsRouter.post('/cloudinary/signature', uploadLimiter, authenticate, requireRole(['admin', 'super_admin']), uploadsController.createCloudinaryUploadSignature)
uploadsRouter.post('/cloudinary/complete', uploadLimiter, authenticate, requireRole(['admin', 'super_admin']), uploadsController.completeCloudinaryUpload)

uploadsRouter.delete(
  '/file',
  authenticate,
  requireRole(['admin', 'super_admin']),
  uploadsController.deleteUploadedFile,
)

export { uploadsRouter }
