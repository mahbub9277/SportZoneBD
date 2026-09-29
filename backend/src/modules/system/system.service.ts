import { prisma } from '../../core/prisma.js'

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

