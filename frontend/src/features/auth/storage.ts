import type { User } from './auth.types'

const USER_KEY = 'sportzone-user'
const STORAGE_VERSION_KEY = 'sportzone-storage-v'

interface StoredAuthState {
  user: User | null
  isAuthenticated: boolean
}

/**
 * Authentication persistence belongs to the server-managed HttpOnly cookies.
 * Clear older profile snapshots so stale user data cannot be mistaken for a session.
 */
export function saveAuthState(_user: User, _token: string | null, _rememberMe: boolean): void {
  clearAuthState()
}

/**
 * Clears all authentication state from both storage types.
 */
export function clearAuthState(): void {
  try {
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(STORAGE_VERSION_KEY)
    sessionStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(STORAGE_VERSION_KEY)
  } catch (error) {
    console.error('Failed to clear auth state', error)
  }
}

/**
 * Loads the initial unauthenticated state. The backend session is authoritative.
 * @returns Empty auth state until refresh and /auth/me confirm the session.
 */
export function loadAuthState(): StoredAuthState {
  clearAuthState()
  return { user: null, isAuthenticated: false }
}

