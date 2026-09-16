import { Router, type Router as ExpressRouter } from 'express'
import rateLimit from 'express-rate-limit'
import { subscriptionRouter } from '../modules/subscriptions/subscription.routes.js'
import { paymentRouter } from '../modules/payments/payment.routes.js'
import { adminRouter } from '../modules/admin/admin.routes.js'
import { settingsRouter } from '../modules/settings/settings.routes.js'
import matchRouter from '../modules/matches/match.routes.js'
import { streamsRouter } from '../modules/streams/streams.routes.js'
import { channelsRouter } from '../modules/channels/channel.routes.js'
import { authRouter } from '../modules/auth/auth.routes.js'
import { highlightsRouter } from '../modules/highlights/highlight.routes.js'
import { authenticate } from '../core/middleware/index.js'
import { analyticsRouter } from '../modules/analytics/analytics.routes.js'
import { notificationsRouter } from '../modules/notifications/notification.routes.js'
import { publicAdvertisementsRouter } from '../modules/advertisements/advertisements.routes.js'
import { systemRouter } from '../modules/system/system.routes.js'
import { publicPopupsRouter } from '../modules/popups/popups.routes.js'
import { proxyRouter } from '../modules/proxy/proxy.routes.js'
import { streamProxyRouter } from './streamProxy.routes.js'
import { standingsRouter } from '../modules/standings/standings.routes.js'
import { reportsRouter } from '../modules/reports/report.routes.js'
import automationRouter from '../modules/automation/automation.routes.js'
import { eventsRouter } from '../modules/events/event.routes.js'
import { publicBannersRouter } from '../modules/banners/banner.routes.js'
import { aiRouter } from '../modules/ai/description.routes.js'
import { paymentLimiter } from '../middleware/rateLimiter.js'
const apiRouter: ExpressRouter = Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
})

apiRouter.use('/auth', authLimiter, authRouter)
apiRouter.use('/advertisements', publicAdvertisementsRouter)
apiRouter.use('/popups', publicPopupsRouter)
apiRouter.use('/subscriptions', (req, res, next) => (req.method === 'GET' || req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), subscriptionRouter)
apiRouter.use('/payments', paymentLimiter, (req, res, next) => {
  if (req.method === 'OPTIONS' || req.path.startsWith('/webhook')) {
    return next()
  }
  return authenticate(req, res, next)
}, paymentRouter)
apiRouter.use('/system', (req, res, next) => (req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), systemRouter)
apiRouter.use('/admin', (req, res, next) => (req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), adminRouter)
apiRouter.use('/admin/automation', (req, res, next) => (req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), automationRouter)
apiRouter.use('/settings', (req, res, next) => (req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), settingsRouter)
apiRouter.use('/streams', (req, res, next) => (req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), streamsRouter)
apiRouter.use('/matches', (req, res, next) => (req.method === 'GET' || req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), matchRouter)
apiRouter.use('/analytics', analyticsRouter)
apiRouter.use('/channels', channelsRouter)
apiRouter.use('/events', eventsRouter)
apiRouter.use('/banners', publicBannersRouter)
apiRouter.use('/standings', standingsRouter)
apiRouter.use('/highlights', (req, res, next) => (req.method === 'GET' || req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), highlightsRouter)
apiRouter.use('/notifications', (req, res, next) => (req.method === 'GET' || req.method === 'OPTIONS' ? next() : authenticate(req, res, next)), notificationsRouter)
apiRouter.use('/reports', reportsRouter)
apiRouter.use('/ai', aiRouter)
// Proxy endpoint for fetching external manifests/segments (used by player when necessary)
apiRouter.use('/proxy', proxyRouter)
apiRouter.use('/stream', streamProxyRouter)

export { apiRouter }