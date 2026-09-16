import { prisma } from '../../core/prisma.js'
import { publicUserSelect, sanitizeUser } from './user.utils.js'

/**
 * Fetches a user's public profile, their roles, and their permissions.
 * This function is cached for 5 minutes to improve performance on repeated calls.
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
            where: { deletedAt: null },
            select: {
              role: {
                select: {
                  id: true,
                  name: true
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
      const { subscriptions, ...userData } = user
      const latestSubscription = subscriptions[0] ?? null
      const subscription = latestSubscription
        ? { ...latestSubscription, status: latestSubscription.status === 'ACTIVE' && latestSubscription.expiresAt > new Date() ? 'ACTIVE' : 'EXPIRED' }
        : null
      return sanitizeUser({ ...userData, subscription })
  })();
}