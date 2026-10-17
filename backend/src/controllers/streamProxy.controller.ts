import type { NextFunction, Request, Response } from 'express'
import { getStreamManifestProxy, getStreamRelayResource } from '../services/streamProxy.service.js'
import { createRelayGate } from '../utils/relayGate.js'
import { isStreamRelaySwitchEnabled, registerRelayRequest } from '../core/streamRelaySwitch.js'
import { StreamRelayDisabledError } from '../core/errors.js'
import { prisma } from '../core/prisma.js'
import { verifyPremiumAccess } from '../core/premiumGuard.js'
import { parseUuidParam } from '../core/validation.js'

/**
 * Relayed media holds a socket and a response body for the length of a viewer's request, so the number in
 * flight at once is bounded per instance. `RELAY_MAX_CONCURRENT` raises it deliberately on a bigger plan.
 */
const relayGate = createRelayGate(Number(process.env.RELAY_MAX_CONCURRENT ?? 24))

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
    const streamId = typeof req.query.streamId === 'string' ? parseUuidParam(req.query.streamId, 'streamId') : undefined
    const channelId = typeof req.query.channelId === 'string' ? parseUuidParam(req.query.channelId, 'channelId') : undefined
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
            channel: {
              select: {
                isPremium: true,
              },
            },
          },
        })
      : null

    const channel = channelId
      ? await prisma.channel.findFirst({
          where: { id: channelId, status: 'ACTIVE' },
          select: { isPremium: true },
        })
      : null

    if (streamId && (!stream || !stream.enabled)) {
      res.status(404).json({ error: 'Stream not found or unavailable' })
      return
    }
    if (channelId && !channel) {
      res.status(404).json({ error: 'Channel not found or unavailable' })
      return
    }

    if ((stream?.match?.premium || stream?.channel?.isPremium || channel?.isPremium)) {
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

/**
 * Serves one media resource of an allowlisted `http://` stream over HTTPS.
 *
 * The record id is required for the same reason as the manifest route — it is what authorization, the
 * premium gate and the allowlist are resolved from — and the byte count is capped while piping, so a
 * response that turns out to be far larger than a segment cannot be buffered in memory.
 */
export async function relayStreamResource(req: Request, res: Response, next: NextFunction): Promise<void> {
  // The administrator's switch is checked before the concurrency slot, the database and the upstream: a
  // disabled relay must cost one cached read and nothing else.
  if (!(await isStreamRelaySwitchEnabled())) {
    next(new StreamRelayDisabledError())
    return
  }

  const release = relayGate.tryEnter()
  if (!release) {
    res.status(503).json({ error: 'The stream relay is busy. Please try again.' })
    return
  }

  const abortController = new AbortController()
  // Registered so switching the relay off aborts this request instead of letting it stream on.
  const unregister = registerRelayRequest(abortController)
  let clientDisconnected = false
  const abortRequest = () => {
    clientDisconnected = true
    if (!res.writableEnded) abortController.abort()
  }

  req.once('aborted', abortRequest)
  res.once('close', abortRequest)

  abortController.signal.addEventListener('abort', () => {
    // Aborting the controller stops the upstream request, which ends the media either way. The disabled
    // answer is only for the viewer who is still there: one who navigated away is already gone, and a
    // response whose headers are sent cannot be replaced by a status code.
    if (clientDisconnected || res.headersSent || res.writableEnded) return
    next(new StreamRelayDisabledError())
  })

  try {
    const streamId = typeof req.query.streamId === 'string' ? parseUuidParam(req.query.streamId, 'streamId') : undefined
    const channelId = typeof req.query.channelId === 'string' ? parseUuidParam(req.query.channelId, 'channelId') : undefined
    const type = typeof req.query.type === 'string' && req.query.type === 'backup' ? 'backup' : 'primary'
    const resourceUrl = typeof req.query.url === 'string' ? req.query.url : ''

    if (!streamId && !channelId) {
      res.status(400).json({ error: 'streamId or channelId is required' })
      return
    }
    if (!resourceUrl) {
      res.status(400).json({ error: 'url is required' })
      return
    }

    const stream = streamId
      ? await prisma.stream.findUnique({
          where: { id: streamId, deletedAt: null },
          select: {
            id: true,
            enabled: true,
            match: { select: { premium: true } },
            channel: { select: { isPremium: true } },
          },
        })
      : null
    const channel = channelId
      ? await prisma.channel.findFirst({ where: { id: channelId, status: 'ACTIVE' }, select: { isPremium: true } })
      : null

    if (streamId && (!stream || !stream.enabled)) {
      res.status(404).json({ error: 'Stream not found or unavailable' })
      return
    }
    if (channelId && !channel) {
      res.status(404).json({ error: 'Channel not found or unavailable' })
      return
    }

    if (stream?.match?.premium || stream?.channel?.isPremium || channel?.isPremium) {
      await verifyPremiumAccess(req, res)
    }

    const result = await getStreamRelayResource({ streamId, channelId, type, resourceUrl, signal: abortController.signal })

    setProxyCorsHeaders(req, res)
    res.setHeader('Content-Type', result.contentType)
    // Media is never stored by an intermediary: segment names repeat across live streams and a cached
    // segment would be the wrong five seconds of video.
    res.setHeader('Cache-Control', 'no-store')

    if (req.method === 'HEAD') {
      result.upstream?.resume()
      res.status(200).end()
      return
    }

    if (result.body !== null) {
      res.status(200).send(result.body)
      return
    }

    const upstream = result.upstream
    if (!upstream) {
      res.status(200).end()
      return
    }

    let receivedBytes = 0
    upstream.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.byteLength
      if (receivedBytes > result.maxBytes) {
        upstream.destroy()
        res.destroy()
      }
    })
    upstream.once('error', () => {
      if (!res.writableEnded) res.destroy()
    })
    res.status(200)
    upstream.pipe(res)
  } catch (error) {
    next(error)
  } finally {
    req.off('aborted', abortRequest)
    res.off('close', abortRequest)
    unregister()
    release()
  }
}
