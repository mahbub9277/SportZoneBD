import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import pg from 'pg'
import logger from './logger.js'

const getSslMode = (env: NodeJS.ProcessEnv = process.env) => {
  const rawValue = [
    env.PGSSLMODE,
    env.PGSSSL_MODE,
    env.DB_SSLMODE,
    env.DBSSSL_MODE,
    env.DBSSSl_MODE,
  ].find((value): value is string => Boolean(value))

  return (rawValue ?? '').trim().toLowerCase()
}

export const resolvePgPoolOptions = (connectionString?: string, env: NodeJS.ProcessEnv = process.env) => {
  const configuredConnectionString = connectionString ?? env.DATABASE_URL ?? env.DIRECT_URL

  if (!configuredConnectionString) {
    return { connectionString: undefined, ssl: undefined }
  }

  if (!/^postgres(?:ql)?:\/\//i.test(configuredConnectionString)) {
    return { connectionString: configuredConnectionString, ssl: undefined }
  }

  const parsedUrl = new URL(configuredConnectionString)
  const sslMode = getSslMode(env)
  const isSupabaseLike = parsedUrl.hostname.includes('supabase.com')
    || parsedUrl.hostname.includes('pooler.supabase.com')
  const isSslDisabled = ['disable', 'off', 'false', '0'].includes(sslMode)
  const shouldUseSsl = isSupabaseLike || ['require', 'prefer', 'verify-ca', 'verify-full'].includes(sslMode)

  if (!isSupabaseLike && isSslDisabled) {
    parsedUrl.searchParams.set('sslmode', 'disable')
    return { connectionString: parsedUrl.toString(), ssl: false }
  }

  if (shouldUseSsl) {
    parsedUrl.searchParams.set('sslmode', 'require')
    // For local development against databases with self-signed certs,
    // we must allow unauthorized certificates.
    if (env.NODE_ENV !== 'production') {
      parsedUrl.searchParams.set('sslaccept', 'accept_invalid_certs')
      return {
        connectionString: parsedUrl.toString(),
        ssl: { rejectUnauthorized: false },
      }
    }
    // For production, enforce strict TLS certificate validation to prevent MITM attacks
    return {
      connectionString: parsedUrl.toString(),
      ssl: { rejectUnauthorized: true },
    }
  }

  return { connectionString: configuredConnectionString, ssl: undefined }
}

const prismaClientSingleton = () => {
  const { connectionString, ssl } = resolvePgPoolOptions(process.env.DATABASE_URL ?? process.env.DIRECT_URL)

  const pool = new pg.Pool({
    connectionString: connectionString || undefined,
    ssl,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 60000),
    keepAlive: true,
    application_name: 'sportzonebd-api',
  })

  pool.on('connect', () => {
    logger.info('Postgres pool connected')
  })

  pool.on('error', (error: Error) => {
    logger.error({ err: error }, 'Postgres pool error')
  })

  const adapter = new PrismaPg(pool)
  const client = new PrismaClient({
    adapter,
    // Enable query logging in non-production environments.
    log: process.env.NODE_ENV !== 'production' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
  })

  // Log query events to Pino logger if not in production
  if (process.env.NODE_ENV !== 'production') {
    client.$on('query', (e: { duration: number; query: string; params: string }) => {
      logger.debug(
        {
          duration: `${e.duration}ms`,
          query: e.query,
          params: e.params, // `e.params` is a string, not an object, so it's fine to log directly.
        },
        'Prisma Query',
      )
    })
  }

  return client
}

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>

const globalForPrisma = globalThis as unknown as { prisma: PrismaClientSingleton | undefined }

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma