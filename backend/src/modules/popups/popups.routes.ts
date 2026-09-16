import { Router } from 'express'
import { popupsController } from '../admin/popups.controller.js'
import { publicApiLimiter } from '../../middleware/rateLimiter.js'

const router = Router()

router.get('/active', publicApiLimiter, popupsController.getActivePopups)

export { router as publicPopupsRouter }