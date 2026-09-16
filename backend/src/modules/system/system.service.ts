import { prisma } from '../../core/prisma.js'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { spawn } from 'node:child_process'
import { uploadStreamToCloudinary, buildCloudinaryRawUrl } from '../../services/upload.service.js'

const gzipAsync = promisify(gzip)

function runPgDump(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const dump = spawn('pg_dump', ['--dbname', databaseUrl, '--no-owner', '--no-privileges'], {
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    const errors: Buffer[] = []

    dump.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    dump.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    dump.once('error', reject)
    dump.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(errors.join('').trim() || `pg_dump exited with code ${code ?? 'unknown'}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
  })
}

interface GetLogsParams {
  page: number
  limit: number
  level?: string
  search?: string
  startDate?: string
  endDate?: string
  kind?: 'audit' | 'activity' | 'system'
}

const AUDIT_MESSAGES = [
  'Match created',
  'Match updated',
  'Match status updated',
  'Match deleted',
  'Stream created',
  'Stream updated',
  'Stream deleted',
]

function buildLogWhere({ level, search, startDate, endDate, kind = 'system' }: GetLogsParams) {
  const conditions: Record<string, unknown>[] = []

  if (level) {
    conditions.push({ level })
  }

  if (search?.trim()) {
    conditions.push({
      message: { contains: search.trim(), mode: 'insensitive' },
    })
  }

  if (startDate || endDate) {
    const createdAt: Record<string, Date> = {}

    if (startDate) {
      const parsedStart = new Date(startDate)
      if (!Number.isNaN(parsedStart.getTime())) {
        createdAt.gte = parsedStart
      }
    }

    if (endDate) {
      const parsedEnd = new Date(endDate)
      if (!Number.isNaN(parsedEnd.getTime())) {
        createdAt.lte = parsedEnd
      }
    }

    if (Object.keys(createdAt).length > 0) {
      conditions.push({ createdAt })
    }
  }

  if (kind === 'audit') {
    conditions.push({ message: { in: AUDIT_MESSAGES } })
  }

  if (kind === 'activity') {
    conditions.push({ NOT: { message: { in: AUDIT_MESSAGES } } })
  }

  return conditions.length > 0 ? { AND: conditions } : {}
}

export async function getLogs({ page, limit, level, search, startDate, endDate, kind = 'system' }: GetLogsParams) {
  const safePage = Number.isFinite(page) && page > 0 ? page : 1
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10

  const where = buildLogWhere({ page: safePage, limit: safeLimit, level, search, startDate, endDate, kind })

  const [items, totalItems] = await prisma.$transaction([
    prisma.systemLog.findMany({
      where,
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
      orderBy: {
        createdAt: 'desc',
      },
    }),
    prisma.systemLog.count({ where }),
  ])

  return {
    items,
    meta: {
      totalItems,
      itemCount: items.length,
      itemsPerPage: safeLimit,
      totalPages: Math.ceil(totalItems / safeLimit),
      currentPage: safePage,
    },
  }
}

// Backup Services
export async function createBackupJob() {
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DIRECT_URL or DATABASE_URL is required to create a backup.')
  }

  const fileName = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`
  const backup = await prisma.backup.create({
    data: {
      fileName,
      size: 0n,
      status: 'PENDING',
    },
  })

  try {
    const dump = await runPgDump(databaseUrl)
    const compressedDump = await gzipAsync(dump)
    await uploadStreamToCloudinary(compressedDump, 'sportzone/backups', undefined, {
      resource_type: 'raw',
      public_id: fileName,
    })

    return prisma.backup.update({
      where: { id: backup.id },
      data: { size: BigInt(compressedDump.byteLength), status: 'COMPLETED' },
    })
  } catch (error) {
    await prisma.backup.update({ where: { id: backup.id }, data: { status: 'FAILED' } }).catch(() => undefined)
    throw error
  }
}

export async function getBackups() {
  return prisma.backup.findMany({
    orderBy: {
      createdAt: 'desc',
    },
  })
}

export async function getBackupDownloadUrl(id: string) {
  const backup = await prisma.backup.findUnique({ where: { id } })
  if (!backup || backup.status !== 'COMPLETED') return null

  return {
    fileName: backup.fileName,
    downloadUrl: buildCloudinaryRawUrl(`sportzone/backups/${backup.fileName}`),
  }
}