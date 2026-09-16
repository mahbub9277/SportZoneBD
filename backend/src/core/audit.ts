import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

export type AuditLogLevel = 'info' | 'warn' | 'error'

export async function writeAuditLog(
  message: string,
  meta: Record<string, unknown> = {},
  level: AuditLogLevel = 'info',
) {
  return prisma.systemLog.create({
    data: {
      level,
      message,
      meta: (Object.keys(meta).length > 0 ? meta : undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}
