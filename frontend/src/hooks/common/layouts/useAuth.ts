import { useMemo, useCallback } from 'react'
import { useAppSelector } from '../../../app/hooks'
import { selectCurrentUser, selectIsAuthenticated } from '../../../features/auth/auth.slice'
import type { User } from '../../../features/auth/auth.types'

interface AuthContextValue {
  user: User | null
  isAuthenticated: boolean
  isAdmin: boolean
  isSuperAdmin: boolean
  hasRole: (role: string | string[]) => boolean
}

const ADMIN_ROLES = Object.freeze(['admin', 'super_admin'])

/**
 * Checks if a user has one or more specified roles.
 * @param user - The user object to check.
 * @param roles - Single role or array of roles to check for.
 * @returns True if user has at least one of the specified roles.
 */
function userHasRole(user: User | null, roles: string | string[] | readonly string[]): boolean {
  if (!user?.roles || !Array.isArray(user.roles)) {
    return false
  }

  const rolesArray = Array.isArray(roles) ? Array.from(roles) : [roles]

  return user.roles.some((role) => {
    const roleName = typeof role === 'string' ? role : role?.name
    return roleName && rolesArray.includes(roleName.toLowerCase())
  })
}

/**
 * Hook for accessing authenticated user state and role information.
 * Provides memoized role checks and admin status flags.
 * @returns Auth context with user, authentication status, and role checks.
 */
export const useAuth = (): AuthContextValue => {
  const user = useAppSelector(selectCurrentUser)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)

  const isAdmin = useMemo(() => userHasRole(user, ADMIN_ROLES), [user])

  const isSuperAdmin = useMemo(() => userHasRole(user, 'super_admin'), [user])

  const hasRole = useCallback(
    (roles: string | string[]) => userHasRole(user, roles),
    [user],
  )

  return useMemo(
    () => ({
      user,
      isAuthenticated,
      isAdmin,
      isSuperAdmin,
      hasRole,
    }),
    [user, isAuthenticated, isAdmin, isSuperAdmin, hasRole],
  )
}
