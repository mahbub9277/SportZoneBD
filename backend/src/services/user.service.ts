import { prisma } from '../core/prisma.js';
import { publicUserSelect } from '../utils/user.utils.js';
import { cache } from '../core/cache.js';

/**
 * Fetches a user's public profile by their ID.
 * @param {string} userId - The ID of the user to fetch.
 * @returns {Promise<object | null>} The user profile object or null if not found.
 */
export const getUserProfile = async (userId: string) => {
  const cacheKey = `user-profile:${userId}`;
  const ttlSeconds = 60 * 5; // Cache for 5 minutes

  return cache(cacheKey, async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        ...publicUserSelect,
        roles: {
          select: {
            role: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
    // In a real application, you might want to sanitize the user object here
    return user;
  }, ttlSeconds, [`user:${userId}`]);
};