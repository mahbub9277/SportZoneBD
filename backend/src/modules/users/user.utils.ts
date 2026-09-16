export const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  username: true,
  avatar: true,
  guestMode: true,
  isActive: true,
  isSuspended: true,
  isBanned: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

type PublicUser = {
  id: string
  email: string | null
  username: string | null
  fullName: string | null
  avatar: string | null
  guestMode: boolean
  isActive: boolean
  isSuspended: boolean
  isBanned: boolean
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function sanitizeUser(user: PublicUser & { deletedAt?: Date | null, roles?: any[], subscription?: any | null }): PublicUser & { roles?: any[], subscription?: any | null } {
  const { deletedAt, ...publicData } = user
  return publicData
}