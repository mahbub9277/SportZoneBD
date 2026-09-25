import type { User } from './auth.types'

const USER_KEY = 'sportzone-user'
const STORAGE_VERSION_KEY = 'sportzone-storage-v'

interface StoredAuthState {
  user: User | null
  isAuthenticated: boolean
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

