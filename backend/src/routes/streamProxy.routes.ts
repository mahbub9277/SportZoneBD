import { Router } from 'express'
import { optionsStreamManifest, proxyStreamManifest, relayStreamResource } from '../controllers/streamProxy.controller.js'

const streamProxyRouter = Router()

streamProxyRouter.options('/proxy', optionsStreamManifest)
streamProxyRouter.head('/proxy', proxyStreamManifest)
streamProxyRouter.get('/proxy', proxyStreamManifest)

// Media of an explicitly allowlisted `http://` provider, served over HTTPS so a browser can play it.
// Only resources named by a playlist this service produced reach it, and each request is re-authorized.
streamProxyRouter.options('/relay', optionsStreamManifest)
streamProxyRouter.head('/relay', relayStreamResource)
streamProxyRouter.get('/relay', relayStreamResource)
streamProxyRouter.head('/play/:channelId', (req, res, next) => {
	req.query.channelId = req.params.channelId
	return proxyStreamManifest(req, res, next)
})
streamProxyRouter.get('/play/:channelId', (req, res, next) => {
	req.query.channelId = req.params.channelId
	return proxyStreamManifest(req, res, next)
})

export { streamProxyRouter }
