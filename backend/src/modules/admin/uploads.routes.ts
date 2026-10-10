import { Router } from 'express'
import { authenticate, requirePermission, requireRole } from '../../core/middleware/index.js';
import { uploadsController } from './uploads.controller.js'
import { uploadLimiter } from '../../middleware/rateLimiter.js'

const uploadsRouter = Router()

const canManageMedia = requirePermission('admin.media.manage');

uploadsRouter.post('/cloudinary/signature', uploadLimiter, authenticate, canManageMedia, uploadsController.createCloudinaryUploadSignature)
uploadsRouter.post('/cloudinary/complete', uploadLimiter, authenticate, canManageMedia, uploadsController.completeCloudinaryUpload)

uploadsRouter.delete(
  '/file',
  authenticate,
  canManageMedia,
  uploadsController.deleteUploadedFile,
)

export { uploadsRouter }
