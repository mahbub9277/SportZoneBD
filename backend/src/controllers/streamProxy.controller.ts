import type { NextFunction, Request, Response } from 'express'
import { getStreamManifestProxy } from '../services/streamProxy.service.js'
import { prisma } from '../core/prisma.js'
import { verifyPremiumAccess } from '../core/premiumGuard.js'

const proxyAllowedOrigins = new Set([
  ...(process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ...(process.env.FRONTEND_URL ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ...(process.env.BASE_URL ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5175', 'http://127.0.0.1:5175']),
])

function setProxyCorsHeaders(req: Request, res: Response): void {
  const origin = req.get('origin')
  if (origin && proxyAllowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, Origin, Referer, User-Agent')
  res.setHeader('Vary', 'Origin')
}

export async function proxyStreamManifest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const abortController = new AbortController()
  const abortRequest = () => {
    if (!res.writableEnded) abortController.abort()
  }

  req.once('aborted', abortRequest)
  res.once('close', abortRequest)

  try {
    const streamId = typeof req.query.streamId === 'string' ? req.query.streamId : undefined
    const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : undefined
    const type = typeof req.query.type === 'string' && req.query.type === 'backup' ? 'backup' : 'primary'
    const directUrl = typeof req.query.url === 'string' ? req.query.url : undefined

    if (!streamId && !channelId) {
      res.status(400).json({ error: 'streamId or channelId is required' })
      return
    }

    const stream = streamId
      ? await prisma.stream.findUnique({
          where: { id: streamId, deletedAt: null },
          select: {
            id: true,
            enabled: true,
            match: {
              select: {
                premium: true,
              },
            },
          },
        })
      : null

    if (streamId && (!stream || !stream.enabled)) {
      res.status(404).json({ error: 'Stream not found or unavailable' })
      return
    } else if (stream && stream.match?.premium) {
      await verifyPremiumAccess(req, res)
    }

    const result = await getStreamManifestProxy({ streamId, channelId, type, targetUrl: directUrl, signal: abortController.signal })
    setProxyCorsHeaders(req, res)
    res.setHeader('Cache-Control', result.cacheControl)
    res.setHeader('Content-Type', result.contentType)
    res.setHeader('X-Stream-Proxy-Used-Backup', result.usedBackup ? 'true' : 'false')

    if (req.method === 'HEAD') {
      res.status(200).end()
      return
    }

    res.status(200).send(result.body)
  } catch (error) {
    next(error)
  } finally {
    req.off('aborted', abortRequest)
    res.off('close', abortRequest)
  }
}

export async function optionsStreamManifest(req: Request, res: Response): Promise<void> {
  setProxyCorsHeaders(req, res)
  res.status(204).end()
}
