import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import logger from './logger.js'
import { defaultPermissions, defaultRoles, rolePermissions } from './rbacConfig.js'

export { defaultPermissions, defaultRoles, rolePermissions } from './rbacConfig.js'

export async function ensureDefaultRBAC() {
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      logger.info('Syncing default roles and permissions...')

      // 1. Upsert all default roles
      await Promise.all(
        defaultRoles.map((role) => tx.role.upsert({ where: { name: role.name }, update: {}, create: role })),
      )

      // 2. Upsert all default permissions
      await Promise.all(
        defaultPermissions.map((permission) =>
          tx.permission.upsert({ where: { key: permission.key }, update: {}, create: permission }),
        ),
      )

      // 3. Assign permissions to roles. `connect` is additive, so an administrator's own tweaks to a
      // system role survive a re-seed and repeated runs never create duplicate links.
      for (const [roleName, permissions] of Object.entries(rolePermissions)) {
        if (permissions.length > 0) {
          await tx.role.update({
            where: { name: roleName },
            data: {
              permissions: {
                connect: permissions.map((key) => ({ key })),
              },
            },
          })
        }
      }
      logger.info('Default roles and permissions synced successfully.')
    },
    {
      maxWait: 5000, // default
      timeout: 10000, // default
    },
  ).catch((error: Error) => {
    logger.warn({ error: error.message }, 'RBAC bootstrap skipped because the database is not ready yet')
  })
}

export async function ensureUserRole(userId: string, roleName: string) {
  const role = await prisma.role.findUnique({ where: { name: roleName } })

  if (!role) {
    return
  }

  const existing = await prisma.userRole.findUnique({
    where: {
      userId_roleId: {
        userId,
        roleId: role.id,
      },
    },
  })

  if (!existing) {
    await prisma.userRole.create({
      data: {
        userId,
        roleId: role.id,
      },
    })
  }
}
