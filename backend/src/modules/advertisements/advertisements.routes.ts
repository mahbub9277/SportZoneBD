import { Router, type Request, type Response } from 'express'
import { advertisementsController } from '../admin/advertisements.controller.js'
import { publicApiLimiter } from '../../middleware/rateLimiter.js'
import { authenticate, optionalProtect } from '../../core/middleware/index.js'
import { AD_SESSION_COOKIE, cancelViewSession, completeViewSession, getAdvertisementForUnlock, getInterstitialAdvertisement, getValidAccess, startViewSession } from './advertisements.service.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'

const recordAdvertisementEvent = (type: string, entityId: string, req: Request) => prisma.analyticsEvent.create({
	data: { type, entityId, userId: (req.user as { id?: string } | undefined)?.id, ipAddress: req.ip, userAgent: req.get('User-Agent') },
})

const router = Router()

router.get('/active', publicApiLimiter, advertisementsController.getActiveAdvertisements)
router.get('/interstitial/:placement', publicApiLimiter, asyncHandler(async (req: Request, res: Response) => {
	const placement = req.params.placement?.toUpperCase()
	if (placement !== 'MATCH' && placement !== 'CHANNEL' && placement !== 'FULL_PAGE') return res.status(400).json({ success: false, message: 'Invalid advertisement placement.' })
	const advertisement = await getInterstitialAdvertisement(placement)
	res.json({ success: true, data: advertisement })
}))
router.get('/unlock', optionalProtect, asyncHandler(async (req: Request, res: Response) => {
	const userId = (req.user as { id?: string } | undefined)?.id
	res.json({ success: true, data: await getValidAccess(userId, req.cookies?.[AD_SESSION_COOKIE]) })
}))
router.post('/session/start', optionalProtect, asyncHandler(async (req: Request, res: Response) => {
	const userId = (req.user as { id?: string } | undefined)?.id
	const advertisementId = typeof req.body?.advertisementId === 'string' ? req.body.advertisementId : ''
	const advertisement = await getAdvertisementForUnlock(advertisementId)
	if (!advertisement) return res.status(400).json({ success: false, message: 'Advertisement is no longer active.' })
	const started = await startViewSession(advertisement.id, userId)
	if (!started) return res.status(400).json({ success: false, message: 'Unable to start advertisement session.' })
	void recordAdvertisementEvent('ADVERTISEMENT_SESSION_STARTED', advertisement.id, req).catch(() => undefined)
	res.cookie(AD_SESSION_COOKIE, started.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: (advertisement.durationSeconds + 600) * 1000 })
	res.json({ success: true, data: { sessionId: started.session.id, startedAt: started.session.startedAt, durationSeconds: started.session.durationSeconds } })
}))
router.post('/session/:id/complete', optionalProtect, asyncHandler(async (req: Request, res: Response) => {
	const userId = (req.user as { id?: string } | undefined)?.id
	const token = req.cookies?.[AD_SESSION_COOKIE]
	if (!token) return res.status(400).json({ success: false, message: 'Advertisement session is unavailable.' })
	const completed = await completeViewSession(req.params.id, token, userId)
	if (!completed) return res.status(400).json({ success: false, message: 'Advertisement countdown is not complete.' })
	if (!completed.alreadyCompleted) void recordAdvertisementEvent('ADVERTISEMENT_SESSION_COMPLETED', completed.completed.advertisementId, req).catch(() => undefined)
	res.json({ success: true, data: { expiresAt: completed.unlockExpiresAt } })
}))
router.post('/session/:id/cancel', optionalProtect, asyncHandler(async (req: Request, res: Response) => {
	const token = req.cookies?.[AD_SESSION_COOKIE]
	if (token) {
		const canceled = await cancelViewSession(req.params.id, token)
		if (canceled.count > 0) {
			const session = await prisma.adViewSession.findUnique({ where: { id: req.params.id }, select: { advertisementId: true } })
			if (session) void recordAdvertisementEvent('ADVERTISEMENT_SESSION_CANCELLED', session.advertisementId, req).catch(() => undefined)
		}
	}
	res.status(204).send()
}))

export { router as publicAdvertisementsRouter }