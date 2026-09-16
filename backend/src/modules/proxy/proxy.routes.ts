import { Router, type Request, type Response } from 'express'
import axios from 'axios'
import type { Readable } from 'node:stream'
import logger from '../../core/logger.js'
import rateLimit from 'express-rate-limit'
import { validateProxyTargetUrl } from '../../utils/ssrfGuard.js'

const router = Router()

// Allowlist of hosts that can be proxied (comma-separated in env).
const allowlistEnv = String(process.env.PROXY_ALLOWLIST ?? '')
const allowlist = allowlistEnv
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
  .map((host) => host.replace(/^https?:\/\//, '').replace(/:\d+$/, ''))

const isDev = process.env.NODE_ENV !== 'production'
const frontendOriginEnv = String(process.env.FRONTEND_ORIGIN ?? '')
const allowedFrontendOrigins = frontendOriginEnv
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const proxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many stream proxy requests. Please try again later.' },
})
const MAX_PROXY_MANIFEST_BYTES = 2 * 1024 * 1024

router.use(proxyLimiter)

async function validateLegacyProxyUrl(value: string): Promise<void> {
  const validated = await validateProxyTargetUrl(value, {
    allowedDomains: allowlist,
    requireAllowlist: allowlist.length > 0,
  })
  if (validated.url.protocol !== 'https:') {
    throw new Error('Only HTTPS proxy targets are allowed')
  }
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true

  if (allowedFrontendOrigins.length === 0) {
    return !isDev
  }

  try {
    const requested = new URL(origin)
    const requestedOrigin = `${requested.protocol}//${requested.host}`
    return allowedFrontendOrigins.some((candidate) => {
      try {
        const parsed = new URL(candidate)
        return `${parsed.protocol}//${parsed.host}` === requestedOrigin
      } catch {
        return candidate === requestedOrigin
      }
    })
  } catch {
    return false
  }
}

function sendCorsHeaders(req: Request, res: Response) {
  const origin = req.get('Origin') ?? undefined

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else if (!isDev && frontendOriginEnv) {
    res.setHeader('Access-Control-Allow-Origin', frontendOriginEnv)
  } else if (isDev) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, Origin, Referer, User-Agent')
}

function getForwardHeaders(req: Request) {
  const forwarded: Record<string, string> = {}
  for (const header of ['referer', 'origin', 'user-agent', 'accept', 'accept-language', 'range']) {
    const value = req.get(header)
    if (value) {
      forwarded[header] = value
    }
  }
  return forwarded
}

// Helper: rewrite manifest text by turning absolute/relative URIs into proxy URLs
function rewriteManifest(manifestText: string, manifestUrl: string) {
  const base = new URL(manifestUrl)
  const lines = manifestText.split(/\r?\n/)
  const rewritten = lines.map(line => {
    if (!line || line.startsWith('#')) return line
    try {
      const abs = new URL(line, base).toString()
      return `/api/v1/proxy?url=${encodeURIComponent(abs)}`
    } catch (e) {
      return line
    }
  })
  return rewritten.join('\n')
}

router.head('/', async (req, res) => {
  const { url } = req.query
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url query parameter' })
  }

  try {
    await validateLegacyProxyUrl(url)
  } catch {
    return res.status(403).json({ error: 'Host not allowed' })
  }

  try {
    const response = await axios.head(url, {
      validateStatus: () => true,
      headers: getForwardHeaders(req),
      timeout: 5000,
    })

    sendCorsHeaders(req, res)
    res.status(response.status)
    const contentTypeHeader = response.headers['content-type']
    if (typeof contentTypeHeader === 'string') {
      res.setHeader('Content-Type', contentTypeHeader)
    } else if (Array.isArray(contentTypeHeader)) {
      res.setHeader('Content-Type', contentTypeHeader.join(', '))
    }

    const contentLengthHeader = response.headers['content-length']
    if (typeof contentLengthHeader === 'string' || typeof contentLengthHeader === 'number') {
      res.setHeader('Content-Length', String(contentLengthHeader))
    }
    return res.end()
  } catch (err: any) {
    logger.error({ error: err, url }, 'Proxy HEAD error fetching')
    return res.status(502).json({ error: 'Bad gateway' })
  }
})

router.get('/', async (req, res) => {
  const { url } = req.query
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url query parameter' })
  }

  try {
    await validateLegacyProxyUrl(url)
  } catch {
    return res.status(403).json({ error: 'Host not allowed' })
  }

  let upstreamStream: Readable | null = null

  const abortUpstream = () => {
    if (!upstreamStream || upstreamStream.destroyed) return
    upstreamStream.destroy()
    upstreamStream = null
  }

  req.once('aborted', abortUpstream)
  res.once('close', abortUpstream)

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      validateStatus: () => true,
      headers: getForwardHeaders(req),
      timeout: 15000,
    })
    upstreamStream = response.data as Readable

    const contentType = String(response.headers['content-type'] ?? '')
    sendCorsHeaders(req, res)

    if (/mpegurl|vnd\.apple\.mpegurl|application\/x-mpegURL/i.test(contentType) || url.endsWith('.m3u8')) {
      const chunks: Buffer[] = []
      let totalBytes = 0
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          totalBytes += chunk.byteLength
          if (totalBytes > MAX_PROXY_MANIFEST_BYTES) {
            response.data.destroy(new Error('Manifest response is too large'))
            reject(new Error('Manifest response is too large'))
            return
          }
          chunks.push(chunk)
        })
        response.data.on('end', resolve)
        response.data.on('error', reject)
      })
      abortUpstream()
      const text = Buffer.concat(chunks).toString('utf8')
      const rewritten = rewriteManifest(text, url)
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      return res.status(response.status).send(rewritten)
    }

    res.setHeader('Content-Type', String(contentType || 'application/octet-stream'))
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', String(response.headers['content-length']))
    }
    res.status(response.status)
    response.data.on('error', (streamError: Error) => {
      abortUpstream()
      logger.error({ error: streamError, url }, 'Proxy stream error')
      if (!res.headersSent) {
        res.status(502).json({ error: 'Bad gateway' })
      } else {
        res.end()
      }
    })
    response.data.pipe(res)
    return
  } catch (err: any) {
    abortUpstream()
    logger.error({ error: err, url }, 'Proxy error fetching')
    return res.status(502).json({ error: 'Bad gateway' })
  }
})

export { router as proxyRouter }
