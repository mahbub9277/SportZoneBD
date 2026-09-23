import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticate } from '../../core/middleware/index.js'
import { generateDescriptionController, parseMatchController } from './description.controller.js'

const aiRouter = Router()
const descriptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
})
const matchParseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
})

aiRouter.use(authenticate)
aiRouter.post('/description/generate', descriptionLimiter, generateDescriptionController)
aiRouter.post('/match/parse', matchParseLimiter, parseMatchController)

export { aiRouter }
