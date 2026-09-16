import { Router } from 'express'
import { authenticate, requireRole } from '../../core/middleware/index.js'
import * as controller from './banner.controller.js'

export const publicBannersRouter = Router()
publicBannersRouter.get('/active', controller.getActiveBanners)

export const adminBannersRouter = Router()
adminBannersRouter.use(authenticate, requireRole(['admin', 'super_admin']))
adminBannersRouter.get('/', controller.getAdminBanners)
adminBannersRouter.post('/', controller.createBanner)
adminBannersRouter.patch('/reorder', controller.reorderBanners)
adminBannersRouter.patch('/:id', controller.updateBanner)
adminBannersRouter.delete('/:id', controller.deleteBanner)