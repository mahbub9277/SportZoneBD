/**
 * Role-assignment authority.
 *
 * Kept as pure functions so the rule that stops a non-administrative operator from minting an
 * administrative account can be unit tested without a database.
 */

/** Roles that carry administrative authority over the platform. */
export const PRIVILEGED_ROLE_NAMES = ['super_admin', 'admin'] as const

/** Roles that are allowed into a staff-facing console rather than the public application. */
export const STAFF_ROLE_NAMES = ['super_admin', 'admin', 'moderator'] as const

/** True when the role name is one the platform ships with rather than an administrator-made role. */
export function isPrivilegedRoleName(roleName: string): boolean {
  return (PRIVILEGED_ROLE_NAMES as readonly string[]).includes(roleName)
}

/**
 * Decides whether an actor holding `actorRoles` may grant `roleName`.
 *
 * `admin` and `super_admin` are peers: the platform grants them equal administrative powers, so
 * either one may grant either role, including `super_admin`. Administrative roles stay limited to
 * administrative actors, so a non-administrative role that holds the user-management permission still
 * cannot mint an administrator. Every other role is grantable by whoever already holds the permission
 * that guards this endpoint.
 */
export function canAssignRole(actorRoles: readonly string[], roleName: string): boolean {
  if (isPrivilegedRoleName(roleName)) {
    return actorRoles.includes('admin') || actorRoles.includes('super_admin')
  }
  return true
}

/**
 * Returns the first role the actor is not allowed to grant, or `null` when the whole selection is
 * permitted.
 */
export function findUngrantableRole(actorRoles: readonly string[], roleNames: readonly string[]): string | null {
  for (const roleName of roleNames) {
    if (!canAssignRole(actorRoles, roleName)) {
      return roleName
    }
  }
  return null
}

/**
 * Whether a set of roles satisfies a role requirement.
 *
 * Denies by default: a user with no roles never satisfies a role requirement, and an empty
 * requirement list places no restriction.
 */
export function rolesAllow(userRoles: readonly string[] | undefined, requiredRoles: readonly string[]): boolean {
  if (!userRoles || userRoles.length === 0) {
    return requiredRoles.length === 0
  }
  if (requiredRoles.length === 0) {
    return true
  }
  return userRoles.some((role) => requiredRoles.includes(role))
}

/**
 * Whether a set of permissions satisfies a permission requirement (all of them must be held).
 *
 * Denies by default: a missing or empty permission list satisfies nothing except an empty
 * requirement list.
 */
export function permissionsAllow(
  userPermissions: readonly string[] | undefined,
  requiredPermissions: readonly string[],
): boolean {
  if (requiredPermissions.length === 0) {
    return true
  }
  if (!userPermissions || userPermissions.length === 0) {
    return false
  }
  return requiredPermissions.every((permission) => userPermissions.includes(permission))
}
