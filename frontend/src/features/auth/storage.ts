import type { User } from './auth.types'

const USER_KEY = 'sportzone-user'
const STORAGE_VERSION_KEY = 'sportzone-storage-v'
const AUTH_BOOTSTRAP_HINT_KEY = 'sportzone-auth-bootstrap-hint'
const AUTH_BOOTSTRAP_LOCK_KEY = 'sportzone-auth-bootstrap-lock'

interface StoredAuthState {
  user: User | null
  isAuthenticated: boolean
}

export function setAuthBootstrapHint(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(AUTH_BOOTSTRAP_HINT_KEY, 'true')
      return
    }
    localStorage.removeItem(AUTH_BOOTSTRAP_HINT_KEY)
  } catch {
    // The hint is optional and should never be required for authorization.
  }
}

export function hasAuthBootstrapHint(): boolean {
  try {
    return localStorage.getItem(AUTH_BOOTSTRAP_HINT_KEY) === 'true'
  } catch {
    return false
  }
}

export function acquireAuthBootstrapLock(): boolean {
  try {
    if (sessionStorage.getItem(AUTH_BOOTSTRAP_LOCK_KEY) === 'true') {
      return false
    }
    sessionStorage.setItem(AUTH_BOOTSTRAP_LOCK_KEY, 'true')
    return true
  } catch {
    return false
  }
}

export function releaseAuthBootstrapLock(): void {
  try {
    sessionStorage.removeItem(AUTH_BOOTSTRAP_LOCK_KEY)
  } catch {
    // Ignore storage failures. This lock is only a client-side optimization hint.
  }
}

export function hasAuthBootstrapLock(): boolean {
  try {
    return sessionStorage.getItem(AUTH_BOOTSTRAP_LOCK_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Clears all authentication state from both storage types.
 */
export function clearAuthState(): void {
  try {
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(STORAGE_VERSION_KEY)
    localStorage.removeItem(AUTH_BOOTSTRAP_HINT_KEY)
    sessionStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(STORAGE_VERSION_KEY)
    sessionStorage.removeItem(AUTH_BOOTSTRAP_LOCK_KEY)
  } catch (error) {
    console.error('Failed to clear auth state', error)
  }
}

/**
 * Loads the initial unauthenticated state. The backend session is authoritative.
 * @returns Empty auth state until refresh and /auth/me confirm the session.
 */
export function loadAuthState(): StoredAuthState {
  return { user: null, isAuthenticated: false }
}

