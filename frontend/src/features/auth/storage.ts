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

/**
 * The bootstrap lock is a short-lived optimization hint: it stops a second tab from repeating the
 * refresh + /auth/me bootstrap while one is already in flight. It is stored as the acquisition
 * timestamp so a lock left behind by a closed/reloaded tab can expire instead of blocking a new
 * bootstrap attempt forever. The window is comfortably longer than the 8s bootstrap safety timeout,
 * so an in-flight bootstrap is never treated as stale.
 */
const AUTH_BOOTSTRAP_LOCK_TTL_MS = 15_000

function readAuthBootstrapLockAt(): number | null {
  try {
    const raw = sessionStorage.getItem(AUTH_BOOTSTRAP_LOCK_KEY)
    if (!raw) return null
    const acquiredAt = Number(raw)
    if (!Number.isFinite(acquiredAt) || acquiredAt <= 0) {
      // Legacy 'true' value (or corrupted data) carries no expiry, so it cannot be trusted.
      sessionStorage.removeItem(AUTH_BOOTSTRAP_LOCK_KEY)
      return null
    }
    return acquiredAt
  } catch {
    return null
  }
}

export function acquireAuthBootstrapLock(): boolean {
  if (hasAuthBootstrapLock()) {
    return false
  }
  try {
    sessionStorage.setItem(AUTH_BOOTSTRAP_LOCK_KEY, String(Date.now()))
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
  const acquiredAt = readAuthBootstrapLockAt()
  if (acquiredAt === null) return false

  if (Date.now() - acquiredAt > AUTH_BOOTSTRAP_LOCK_TTL_MS) {
    releaseAuthBootstrapLock()
    return false
  }

  return true
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

