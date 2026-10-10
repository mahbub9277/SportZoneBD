import type { User } from './auth.types'

/**
 * Which console a signed-in user belongs to.
 *
 * This is a presentation decision only. The backend resolves the user's roles and permissions and
 * enforces them on every request; the client uses the same resolved data to send a user to the entry
 * point that matches and to avoid rendering navigation they could not use.
 */
export type AuthExperience = 'admin' | 'moderator' | 'staff' | 'user'

const ADMIN_ROLE_NAMES = ['admin', 'super_admin']
const MODERATOR_ROLE_NAMES = ['moderator']

/**
 * The profile nests each role under a `role` key; some endpoints return a flattened role. Both shapes
 * are read here so the helpers work with whichever payload reached the store.
 */
function roleName(entry: NonNullable<User['roles']>[number]): string | undefined {
  return entry.role?.name ?? entry.name
}

function roleIsSystem(entry: NonNullable<User['roles']>[number]): boolean | undefined {
  return entry.role?.isSystem ?? entry.isSystem
}

function rolePermissionKeys(entry: NonNullable<User['roles']>[number]): string[] {
  return [...(entry.role?.permissions ?? []), ...(entry.permissions ?? [])].map((permission) => permission.key)
}

/** The role names carried by a user, tolerating both profile shapes in use. */
export function getRoleNames(user: User | null | undefined): string[] {
  return (
    user?.roles
      ?.map((role) => roleName(role))
      .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? []
  )
}

/** The permission keys granted by the user's roles. */
export function getUserPermissions(user: User | null | undefined): string[] {
  const fromProfile = user?.permissions ?? []
  const fromRoles = user?.roles?.flatMap((role) => rolePermissionKeys(role)) ?? []
  return [...new Set([...fromProfile, ...fromRoles])]
}

export function hasPermission(user: User | null | undefined, permission: string): boolean {
  return getUserPermissions(user).includes(permission)
}

export function hasAnyPermission(user: User | null | undefined, permissions: readonly string[]): boolean {
  if (permissions.length === 0) return true
  const granted = getUserPermissions(user)
  return permissions.some((permission) => granted.includes(permission))
}

/**
 * True when the user holds at least one administrator-made role.
 *
 * Seeded system roles either own a dedicated console or belong to the public application; only a
 * custom role has no other entry point, which is exactly what the shared staff console provides.
 */
export function hasCustomRole(user: User | null | undefined): boolean {
  return user?.roles?.some((role) => roleIsSystem(role) === false) ?? false
}

export function resolveAuthExperience(user: User | null | undefined): AuthExperience {
  const roles = getRoleNames(user).map((name) => name.toLowerCase())

  if (roles.some((name) => ADMIN_ROLE_NAMES.includes(name))) return 'admin'
  if (roles.some((name) => MODERATOR_ROLE_NAMES.includes(name))) return 'moderator'
  if (hasCustomRole(user)) return 'staff'
  return 'user'
}

/** Where each experience lands after a successful sign-in. */
export const EXPERIENCE_HOME: Record<AuthExperience, string> = {
  admin: '/admin',
  moderator: '/moderator',
  staff: '/staff',
  user: '/',
}

/** The sign-in route each experience should use. */
export const EXPERIENCE_LOGIN: Record<AuthExperience, string> = {
  admin: '/admin/login',
  moderator: '/moderator/login',
  staff: '/staff/login',
  user: '/login',
}
