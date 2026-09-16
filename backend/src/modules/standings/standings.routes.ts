import { Router } from 'express'
import { getStandings } from './standings.controller.js'
import { cacheMiddleware } from '../../core/middleware/cache.middleware.js'

const standingsRouter = Router()

// Cache standings for 10 minutes (600 seconds) - standings update less frequently
standingsRouter.get('/', cacheMiddleware(600, ['standings']), getStandings)

export { standingsRouter }
