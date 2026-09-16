import { prisma } from '../../core/prisma.js'
import { pick } from '../../utils/pick.js'

/**
 * Finds or creates notification preferences for a user.
 * If preferences don't exist, they are created with default values.
 * @param userId The ID of the user.
 * @returns The user's notification preferences.
 */
export const findOrCreatePreferences = async (userId: string) => {
  let preferences = await prisma.notificationPreferences.findUnique({
    where: { userId },
  })

  if (!preferences) {
    preferences = await prisma.notificationPreferences.create({
      data: { userId },
    })
  }

  return preferences
}

/**
 * Updates notification preferences for a user.
 * @param userId The ID of the user.
 * @param data The preferences data to update.
 * @returns The updated notification preferences.
 */
export const updatePreferences = async (userId: string, data: Record<string, unknown>) => {
  // Whitelist the fields that can be updated to prevent mass assignment vulnerabilities.
  const allowedUpdates = [
    'matchStartEmail',
    'matchStartPush',
    'newHighlightEmail',
    'newHighlightPush',
    'teamNewsEmail',
    'teamNewsPush',
  ]
  const safeData = pick(data, allowedUpdates)

  return prisma.notificationPreferences.update({ where: { userId }, data: safeData })
}
