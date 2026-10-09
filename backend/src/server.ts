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
import { setIoInstance, initializeSocketHandlers, getIoInstance, setSocketClusterAdapterEnabled, setSocketBroadcastGuard } from './core/socketManager.js'
import { createAdapter } from '@socket.io/redis-adapter'
import { attachRedisClientLogging, closeRedisClientSafely, closeRedisFailoverClients, getPrimaryRedisStatus, isRedisConfigured, redis } from './core/redis.js'
import { isMultiInstanceDeployment } from './config/deployment.js'
import { getRedisErrorCode, isRedisProviderFailure } from './core/redisFailover.js'
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

app.get('/', (_req, res) => {
  res.status(200).json({ success: true, message: 'SportZoneBD API is running' })
})

app.get(['/health', '/api/v1/health'], (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'sportzonebd-api' })
})

app.get(['/ready', '/api/v1/ready'], async (_req, res) => {
  const checks: { postgres: 'ok' | 'error'; redis: 'ok' | 'error' | 'not_required' } = {
    postgres: 'error',
    redis: process.env.NODE_ENV === 'production' && isRedisConfigured ? 'error' : 'not_required',
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.postgres = 'ok'
  } catch {
    // Keep readiness responses intentionally free of infrastructure details.
  }

  if (process.env.NODE_ENV === 'production' && isRedisConfigured) {
    checks.redis = getPrimaryRedisStatus() === 'ready' ? 'ok' : 'error'
  }

  const ready = checks.postgres === 'ok'
  const status = !ready ? 'not_ready' : checks.redis === 'error' ? 'degraded' : 'ready'
  res.status(ready ? 200 : 503).json({ status, service: 'sportzonebd-api', checks })
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
      logger.warn('Redis primary is not configured; Redis-dependent features will use their safe fallback behavior')
    } else if (getPrimaryRedisStatus() !== 'ready') {
      logger.warn({ provider: 'primary' }, 'Redis primary is not ready during startup; continuing in degraded mode')
    }
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

    let redisAdapterEnabled = false
    if (!isMultiInstanceDeployment) {
      // A single instance reaches every socket through the process-local adapter, so the Redis
      // adapter would only add one PUBLISH per broadcast plus its own pub/sub connections.
      // Set MULTI_INSTANCE_ENABLED=true before scaling out.
      logger.info('Socket.IO Redis adapter disabled by MULTI_INSTANCE_ENABLED; using the process-local adapter')
    } else if (isRedisConfigured) {
      try {
        pubClient = redis.duplicate()
        subClient = redis.duplicate()
        // The adapter only warns on the console when a client has no 'error' handler of its own, which
        // leaves an adapter outage unlabelled in the logs; attach the same bounded structured logging
        // the cache client uses.
        attachRedisClientLogging(pubClient, 'socket-adapter-pub')
        attachRedisClientLogging(subClient, 'socket-adapter-sub')
        await Promise.all([waitForRedisReady(pubClient), waitForRedisReady(subClient)])
        await Promise.all([pubClient.ping(), subClient.ping()])
        io.adapter(createAdapter(pubClient, subClient))
        redisAdapterEnabled = true
      } catch (error) {
        pubClient?.disconnect?.()
        subClient?.disconnect?.()
        pubClient = null
        subClient = null
        logger.warn({ provider: 'primary', code: getRedisErrorCode(error) }, 'Socket.IO Redis adapter unavailable; using the process-local adapter')
      }
    } else {
      logger.warn('Socket.IO Redis adapter is not configured; using the process-local adapter')
    }

    // Register the io instance globally for use in services
    setIoInstance(io)
    // Viewer counts are read from room membership, which only spans instances while the Redis
    // adapter is installed; without it the process-local membership map is the complete answer.
    setSocketClusterAdapterEnabled(redisAdapterEnabled)
    // ioredis only accepts a command while its connection is 'ready' (`publish` is rejected outright
    // on a non-writable stream with enableOfflineQueue disabled), so every broadcast is gated on that
    // status. Without the gate a transient Redis blip makes the adapter publish fail, and that
    // rejection escapes as an unhandled rejection.
    setSocketBroadcastGuard(() => !redisAdapterEnabled || pubClient?.status === 'ready')

    // Centralize all socket event handling
    initializeSocketHandlers(io)

    logger.info({ redisAdapter: redisAdapterEnabled ? 'enabled' : 'process-local' }, 'Socket.IO initialized and handlers are attached')
  } catch (error) {
    logger.warn({ errorType: error instanceof Error ? error.name : 'unknown' }, 'Socket.IO initialization unavailable')
  }

  startNotificationWorker()
  void matchAutomationService.start().catch((error) => {
    logger.error({ error }, 'Failed to start match automation service')
  })

  // Telemetry maintenance only runs while telemetry is enabled: an installation that boots with
  // Analytics → Telemetry off never starts a telemetry timer, worker or Redis/DB access at all.
  void import('./modules/analytics/telemetry.service.js')
    .then(({ initializeTelemetryRuntime }) => initializeTelemetryRuntime())
    .catch((error) => logger.warn({ error }, 'Telemetry runtime initialization failed'))

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
      // Flush buffered telemetry aggregations before Redis closes, so a graceful restart does not
      // drop the increments accumulated since the last minute boundary. Skipped entirely while
      // telemetry is off: nothing may be written then, and the runtime has already cleared its timer.
      const { flushTelemetryAggregations, isTelemetryEnabled, stopTelemetryRuntime } = await import('./modules/analytics/telemetry.service.js')
      stopTelemetryRuntime()
      if (isTelemetryEnabled()) {
        await flushTelemetryAggregations(true)
        logger.info('Telemetry aggregations flushed.')
      }
    } catch (error) {
      logger.error(error, 'Error flushing telemetry aggregations.')
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
      // Close Socket.IO Redis adapter clients. Each client is closed independently: a client that is
      // already disconnected cannot be quit gracefully, and one failing close must not skip the other
      // client or mask which step failed.
      await closeRedisClientSafely(pubClient, 'socket-adapter-pub')
      pubClient = null
      await closeRedisClientSafely(subClient, 'socket-adapter-sub')
      subClient = null
    } catch (error) {
      logger.error({ code: getRedisErrorCode(error) }, 'Error closing Socket.IO Redis adapter clients.')
    }

    try {
      const { prisma } = await import('./core/prisma.js')
      await prisma.$disconnect()
      logger.info('Prisma client disconnected.')
    } catch (error) {
      logger.error({ code: getRedisErrorCode(error) }, 'Error disconnecting the Prisma client.')
    }

    try {
      await closeRedisFailoverClients()
      await closeRedisClientSafely(redis, 'primary')
    } catch (error) {
      logger.error({ code: getRedisErrorCode(error) }, 'Error during Redis cleanup.')
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

  /**
   * An escaped rejection is normally fatal: an unexpected promise chain is a bug worth a restart.
   *
   * A Redis availability failure is the exception. The Socket.IO adapter ignores the promise its own
   * `publish` returns, so when the provider refuses the write the rejection reaches this handler with
   * no application bug behind it — and restarting the service is what turned a Redis hiccup into a
   * production outage. It is reported at error level with the provider state, and the process keeps
   * serving the requests that do not need Redis (channel lists, match data, HLS proxying).
   */
  const handleUnhandledRejection = (reason: unknown) => {
    if (isRedisProviderFailure(reason)) {
      logger.error({
        context: 'Unhandled rejection',
        code: getRedisErrorCode(reason),
        message: (reason instanceof Error ? reason.message : String(reason)).slice(0, 300),
        redisStatus: getPrimaryRedisStatus(),
        socketAdapterInstalled: Boolean(pubClient),
      }, 'Redis provider failure escaped an async handler; continuing in degraded mode')
      return
    }

    handleFatalError(reason, 'Unhandled rejection')
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('uncaughtException', (error) => handleFatalError(error, 'Uncaught exception'))
  process.on('unhandledRejection', (reason) => handleUnhandledRejection(reason))
}

void bootstrap().catch((error) => {
  const normalizedError = error instanceof Error
    ? error
    : new Error(typeof error === 'string' ? error : JSON.stringify(error) || 'Unknown startup error')
  logger.fatal({ err: normalizedError }, 'Failed to start server')
  process.exit(1)
})
