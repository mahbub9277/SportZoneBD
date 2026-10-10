import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

export type AuditLogLevel = 'info' | 'warn' | 'error'

/**
 * A Prisma client or an open transaction. Accepting the transaction lets a caller write the audit row
 * in the same atomic unit as the change it describes, so an audited mutation is never committed without
 * its record.
 */
export type AuditClient = Pick<Prisma.TransactionClient, 'systemLog'>

export async function writeAuditLog(
  message: string,
  meta: Record<string, unknown> = {},
  level: AuditLogLevel = 'info',
  client: AuditClient = prisma,
) {
  return client.systemLog.create({
    data: {
      level,
      message,
      meta: (Object.keys(meta).length > 0 ? meta : undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}
