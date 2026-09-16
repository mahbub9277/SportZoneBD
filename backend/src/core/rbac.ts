import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import logger from './logger.js'

const defaultRoles = [
  { name: 'super_admin', description: 'Platform administrator', isSystem: true },
  { name: 'admin', description: 'Business administrator', isSystem: true },
  { name: 'premium_user', description: 'Authenticated subscriber', isSystem: true },
  { name: 'user', description: 'Standard authenticated user', isSystem: true },
  { name: 'guest', description: 'Guest user', isSystem: true },
] as const

const defaultPermissions = [
  { key: 'admin.dashboard.view', description: 'View the admin dashboard' },
  { key: 'admin.users.manage', description: 'Manage platform users' },
  { key: 'admin.matches.manage', description: 'Manage match content' },
  { key: 'admin.settings.manage', description: 'Manage platform settings' },
  { key: 'admin.payments.view', description: 'View payment transactions' },
  { key: 'content.live.watch', description: 'Watch premium live content' },
  { key: 'content.highlights.view', description: 'View highlights' },
] as const

type RoleName = (typeof defaultRoles)[number]['name']
type PermissionKey = (typeof defaultPermissions)[number]['key']

const rolePermissions: Record<RoleName, PermissionKey[]> = {
  super_admin: [
    'admin.dashboard.view',
    'admin.users.manage',
    'admin.matches.manage',
    'admin.settings.manage',
    'admin.payments.view',
    'content.live.watch',
    'content.highlights.view',
  ],
  admin: [
    'admin.dashboard.view',
    'admin.users.manage',
    'admin.matches.manage',
    'admin.settings.manage',
    'admin.payments.view',
    'content.highlights.view',
  ],
  premium_user: ['content.live.watch', 'content.highlights.view'],
  user: ['content.highlights.view'],
  guest: [],
}

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

      // 3. Assign permissions to roles
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
