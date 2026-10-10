import { prisma } from '../../core/prisma.js'
import { publicUserSelect, sanitizeUser } from './user.utils.js'

/**
 * Fetches a user's public profile, their roles, and the permissions those roles grant.
 *
 * The role's `isSystem` flag and the resolved permission keys are what let the client route a
 * signed-in user to the console they belong to and hide navigation they could not use. They are
 * presentation hints only: every protected API still decides for itself.
 * @param userId - The ID of the user.
 * @returns The user's full profile including roles and permissions, or null if not found.
 */
export async function getUserProfile(userId: string) {
  return (async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          ...publicUserSelect,
          roles: {
            where: { deletedAt: null, role: { is: { deletedAt: null } } },
            select: {
              role: {
                select: {
                  id: true,
                  name: true,
                  isSystem: true,
                  permissions: {
                    where: { deletedAt: null },
                    select: { key: true },
                  },
                },
              },
            },
          },
          subscriptions: {
            where: { deletedAt: null },
            orderBy: { expiresAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              startedAt: true,
              expiresAt: true,
              plan: { select: { id: true, name: true, price: true, durationDays: true, description: true } },
            },
          },
        },
      });
      if (!user) return null
      const { subscriptions, roles, ...userData } = user
      const latestSubscription = subscriptions[0] ?? null
      const subscription = latestSubscription
        ? { ...latestSubscription, status: latestSubscription.status === 'ACTIVE' && latestSubscription.expiresAt > new Date() ? 'ACTIVE' : 'EXPIRED' }
        : null
      const permissions = [...new Set(roles.flatMap((userRole) => userRole.role.permissions.map((permission) => permission.key)))]
      return sanitizeUser({ ...userData, roles, subscription, permissions })
  })();
}