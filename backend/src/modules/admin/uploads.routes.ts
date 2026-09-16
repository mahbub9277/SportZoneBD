import { Router, type NextFunction, type Request, type Response } from 'express'
import { authenticate, requireRole } from '../../core/middleware/index.js'
import { upload } from '../../middleware/upload.js'
import { uploadsController } from './uploads.controller.js'
import { uploadLimiter } from '../../middleware/rateLimiter.js'

const uploadsRouter = Router()

const uploadFilesMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const middleware = req.query.mediaType === 'VIDEO'
    ? upload.videoArray('files')
    : upload.array('files', 10)
  return middleware(req, res, next)
}

uploadsRouter.post(
  '/file',
  uploadLimiter,
  authenticate,
  requireRole(['admin', 'super_admin']),
  uploadFilesMiddleware,
  uploadsController.uploadFiles,
)

uploadsRouter.delete(
  '/file',
  authenticate,
  requireRole(['admin', 'super_admin']),
  uploadsController.deleteUploadedFile,
)

export { uploadsRouter }
