import { Router } from 'express'
import { optionsStreamManifest, proxyStreamManifest } from '../controllers/streamProxy.controller.js'

const streamProxyRouter = Router()

streamProxyRouter.options('/proxy', optionsStreamManifest)
streamProxyRouter.head('/proxy', proxyStreamManifest)
streamProxyRouter.get('/proxy', proxyStreamManifest)
streamProxyRouter.head('/play/:channelId', (req, res, next) => {
	req.query.channelId = req.params.channelId
	return proxyStreamManifest(req, res, next)
})
streamProxyRouter.get('/play/:channelId', (req, res, next) => {
	req.query.channelId = req.params.channelId
	return proxyStreamManifest(req, res, next)
})

export { streamProxyRouter }
