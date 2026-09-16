import 'dotenv/config'
import compression from 'compression'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import http from 'http'
import cookieParser from 'cookie-parser'
import passport from 'passport'
import helmet from 'helmet'
import addRequestId from 'express-request-id'
import { pinoHttp } from 'pino-http'
import logger from './core/logger.js'
import rateLimit from 'express-rate-limit'
import { errorHandler, notFound } from './core/middleware/index.js'
import { ensureDefaultRBAC } from './core/rbac.js'
import { apiRouter } from './routes/index.js'
import './core/passport.js'
import { corsOptions } from './config/cors.js'
import { matchAutomationService } from './services/matchAutomation.service.js'
import { setIoInstance, initializeSocketHandlers, getIoInstance } from './core/socketManager.js'
import { createAdapter } from '@socket.io/redis-adapter'
import { isRedisConfigured, redis } from './core/redis.js'
import { startNotificationWorker } from './core/notificationQueue.js'
import { prisma } from './core/prisma.js'

async function waitForRedisReady(client: any): Promise<void> {
  if (typeof client.once !== 'function') {
    await client.connect?.()
    return
  }

  if (client.status === 'ready') return

  if (client.status === 'wait') {
    await client.connect()
    return
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      client.removeListener?.('ready', handleReady)
      client.removeListener?.('error', handleError)
    }
    const handleReady = () => {
      cleanup()
      resolve()
    }
    const handleError = (error: unknown) => {
      cleanup()
      reject(error)
    }

    client.once('ready', handleReady)
    client.once('error', handleError)
  })
}

const app = express()
const requestedPort = Number(process.env.PORT ?? 5000)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
})

// Set 'trust proxy' to 1 to trust the first proxy in front of your app.
// This is a secure setting for most environments and resolves the express-rate-limit warning.
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(addRequestId() as any)
app.use(helmet() as any)
app.use(cors(corsOptions) as any)
app.use(compression() as any)
app.use(pinoHttp({
  logger,
  customProps: (req: Request, _res: Response) => ({
    id: req.id,
    userId: (req.user as { id: string })?.id ?? 'anonymous',
  }),
  customLogLevel: function (req: Request, res: Response, err: Error) {
    if (res.statusCode >= 400 && res.statusCode < 500) return 'warn'
    if (res.statusCode >= 500 || err) return 'error'
    if (res.statusCode >= 300 && res.statusCode < 400) return 'silent'
    return 'info'
  },
  customSuccessMessage: (req: Request, res: Response) => `${req.method} ${req.url} - ${res.statusCode} ${http.STATUS_CODES[res.statusCode] ?? 'unknown'}`,
  customErrorMessage: (req: Request, res: Response, err: Error) => `${req.method} ${req.url} - ${res.statusCode} ${http.STATUS_CODES[res.statusCode] ?? 'unknown'} - ${err.message}`,
} as any))

// Use express.json with a 'verify' function to capture the raw body.
// This is crucial for webhook signature validation.
app.use(express.json({
  limit: '1mb',
  verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
    if (req.originalUrl.startsWith('/api/v1/payments/webhook')) {
      req.rawBody = buf
    }
  },
}))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

app.use(cookieParser())
app.use(passport.initialize())
app.use(generalLimiter)

app.get(['/health', '/api/v1/health'], (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'sportzonebd-api' })
})

app.get(['/ready', '/api/v1/ready'], async (_req, res) => {
  const checks: { postgres: 'ok' | 'error'; redis: 'ok' | 'error' | 'not_required' } = {
    postgres: 'error',
    redis: process.env.NODE_ENV === 'production' ? 'error' : 'not_required',
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.postgres = 'ok'
  } catch {
    // Keep readiness responses intentionally free of infrastructure details.
  }

  if (process.env.NODE_ENV === 'production' && isRedisConfigured) {
    try {
      await redis.ping()
      checks.redis = 'ok'
    } catch {
      checks.redis = 'error'
    }
  }

  const ready = checks.postgres === 'ok' && (checks.redis === 'ok' || checks.redis === 'not_required')
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', service: 'sportzonebd-api', checks })
})

app.use('/api/v1', apiRouter)

app.use(notFound)
app.use(errorHandler)

export { app }

async function bootstrap(): Promise<void> {
  try {
    await ensureDefaultRBAC()
  } catch (error) {
    logger.warn({ error }, 'RBAC bootstrap skipped because the database is not ready yet')
  }

  if (process.env.NODE_ENV === 'production') {
    if (!isRedisConfigured) {
      throw new Error('REDIS_URL is required in production.')
    }
    await redis.ping()
  }

  let activeServer: http.Server | undefined
  let isShuttingDown = false
  let fatalErrorHandled = false
  let pubClient: any = null
  let subClient: any = null

  const startListening = (candidatePort: number): Promise<http.Server> => {
    return new Promise((resolve, reject) => {
      activeServer = http.createServer(app)
      activeServer.once('listening', () => {
        const address = activeServer?.address()
        const actualPort = typeof address === 'object' && address ? address.port : candidatePort
        logger.info({ port: actualPort }, 'SportZoneBD API listening')
        resolve(activeServer as http.Server)
      })
      activeServer.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && candidatePort !== 0 && process.env.NODE_ENV !== 'production') {
          logger.warn({ requestedPort: candidatePort }, 'Port is busy, retrying on an available port')
          void startListening(0).then(resolve).catch(reject)
          return
        }

        logger.error(err, `Server error on port ${candidatePort}`)
        reject(err)
      })
      activeServer.listen(candidatePort)
    })
  }

  await startListening(requestedPort)

  // Try to initialize Socket.io for real-time viewer tracking. Use dynamic
  // import so the server can start even when the optional dependency is
  // not installed (avoids hard crash with ERR_MODULE_NOT_FOUND).
  let io: any = null
  try {
    // dynamic import; will throw if socket.io is not installed
    // @ts-ignore: optional dependency may not be installed in every environment
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const socketMod = await import('socket.io') 
    const { Server: IOServer } = socketMod

    io = new IOServer(activeServer!, {
      cors: {
        origin: (corsOptions as any)?.origin ?? '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket'],
    })

    // Create a duplicate of the Redis client for pub/sub
    pubClient = redis.duplicate()
    subClient = redis.duplicate()
    await Promise.all([waitForRedisReady(pubClient), waitForRedisReady(subClient)])
    await Promise.all([pubClient.ping(), subClient.ping()])
    io.adapter(createAdapter(pubClient, subClient))

    // Register the io instance globally for use in services
    setIoInstance(io)

    // Centralize all socket event handling
    initializeSocketHandlers(io)

    logger.info('Socket.IO initialized and handlers are attached.')
  } catch (err) {
    logger.warn('Socket.io not installed; real-time viewer tracking disabled')
  }

  startNotificationWorker()
  void matchAutomationService.start().catch((error) => {
    logger.error({ error }, 'Failed to start match automation service')
  })

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress. Ignoring signal.')
      return
    }

    isShuttingDown = true
    logger.info({ signal }, 'Shutting down gracefully')

    const closeServer = () => new Promise<void>((resolve) => {
      if (!activeServer) {
        resolve()
        return
      }

      // Close Socket.io first to disconnect websocket clients cleanly
      try {
        ;(io as any)?.close?.()
      } catch (err) {
        // ignore
      }

      activeServer.close(() => resolve())
      setTimeout(() => resolve(), 10000)
    })

    await closeServer()
    logger.info('HTTP server closed.')

    try {
      // Stop the match automation cron job
      await matchAutomationService.stop()
      logger.info('Match automation service stopped.')
    } catch (error) {
      logger.error(error, 'Error stopping match automation service.')
    }

    try {
      // Close BullMQ notification queue and worker
      const { closeNotificationQueue } = await import('./core/notificationQueue.js')
      await closeNotificationQueue()
      logger.info('Notification queue and worker closed.')
    } catch (error) {
      logger.error(error, 'Error closing notification queue.')
    }

    try {
      // Close Socket.IO Redis adapter clients
      if (pubClient) {
        await pubClient.quit()
        logger.info('Socket.IO pub client disconnected.')
      }
      if (subClient) {
        await subClient.quit()
        logger.info('Socket.IO sub client disconnected.')
      }
    } catch (error) {
      logger.error(error, 'Error closing Socket.IO Redis adapter clients.')
    }

    try {
      const { prisma } = await import('./core/prisma.js')
      await prisma.$disconnect()
      logger.info('Prisma client disconnected.')
      const { redis } = await import('./core/redis.js')
      await redis.quit()
      logger.info('Redis client disconnected.')
    } catch (error) {
      logger.error(error, 'Error during resource cleanup.')
    }

    process.exit(0)
  }

  const handleFatalError = (error: unknown, context: string) => {
    if (fatalErrorHandled) return
    fatalErrorHandled = true

    const normalizedError = error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error) || 'Unknown fatal error')

    logger.fatal({ err: normalizedError, context }, context)
    void shutdown(context)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('uncaughtException', (error) => handleFatalError(error, 'Uncaught exception'))
  process.on('unhandledRejection', (reason) => handleFatalError(reason, 'Unhandled rejection'))
}

void bootstrap().catch((error) => {
  const normalizedError = error instanceof Error
    ? error
    : new Error(typeof error === 'string' ? error : JSON.stringify(error) || 'Unknown startup error')
  logger.fatal({ err: normalizedError }, 'Failed to start server')
  process.exit(1)
})
