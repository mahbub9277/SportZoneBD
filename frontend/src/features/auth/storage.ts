import type { User } from './auth.types'

const USER_KEY = 'sportzone-user'
const STORAGE_VERSION_KEY = 'sportzone-storage-v'
const CURRENT_STORAGE_VERSION = '1'

interface StoredAuthState {
  user: User | null
  isAuthenticated: boolean
}

/**
 * Validates that a User object has required fields.
 * @param user - The user object to validate.
 * @returns True if user is valid, false otherwise.
 */
function isValidUser(user: unknown): user is User {
  return (
    typeof user === 'object' &&
    user !== null &&
    'id' in user &&
    typeof (user as any).id === 'string' &&
    'email' in user &&
    typeof (user as any).email === 'string'
  )
}

/**
 * Gets the appropriate storage object based on persistence preference.
 * @param rememberMe - Whether to use persistent storage (localStorage) or session storage.
 * @returns The selected Storage object.
 */
function getStorage(rememberMe: boolean): Storage {
  return rememberMe ? localStorage : sessionStorage
}

/**
 * Gets the other storage object (opposite of the selected one).
 * @param rememberMe - The current persistence preference.
 * @returns The opposite Storage object to clear.
 */
function getOtherStorage(rememberMe: boolean): Storage {
  return rememberMe ? sessionStorage : localStorage
}

/**
 * Checks storage version to handle migrations.
 * @param rememberMe - The current storage preference.
 * @returns True if storage version matches, false if migration needed.
 */
function checkStorageVersion(rememberMe: boolean): boolean {
  const storage = getStorage(rememberMe)
  const version = storage.getItem(STORAGE_VERSION_KEY)
  return version === CURRENT_STORAGE_VERSION
}

/**
 * Persists user authentication state with optional persistence.
 * Clears the opposite storage to prevent conflicts.
 * @param user - The authenticated user object.
 * @param _token - The JWT token (handled by secure httpOnly cookie).
 * @param rememberMe - Whether to persist auth across browser sessions.
 * @throws Error if user validation fails.
 */
export function saveAuthState(user: User, _token: string | null, rememberMe: boolean): void {
  if (!isValidUser(user)) {
    throw new Error('Invalid user object provided to saveAuthState')
  }

  const primaryStorage = getStorage(rememberMe)
  const otherStorage = getOtherStorage(rememberMe)

  try {
    // Clear the other storage to prevent conflicts
    otherStorage.removeItem(USER_KEY)
    otherStorage.removeItem(STORAGE_VERSION_KEY)

    // Save to primary storage
    primaryStorage.setItem(USER_KEY, JSON.stringify(user))
    primaryStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION)
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.error('Storage quota exceeded', error)
      throw new Error('Storage quota exceeded. Please clear browser cache.')
    }
    throw error
  }
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
 * Loads persisted authentication state from storage.
 * Checks localStorage first (persistent), then sessionStorage (session-only).
 * Validates stored data before returning.
 * @returns StoredAuthState with user and authentication status.
 */
export function loadAuthState(): StoredAuthState {
  try {
    // Try localStorage first
    let storedUser = localStorage.getItem(USER_KEY)
    let storageVersion = localStorage.getItem(STORAGE_VERSION_KEY)

    // Fall back to sessionStorage
    if (!storedUser) {
      storedUser = sessionStorage.getItem(USER_KEY)
      storageVersion = sessionStorage.getItem(STORAGE_VERSION_KEY)
    }

    // Check version compatibility
    if (storageVersion !== CURRENT_STORAGE_VERSION) {
      clearAuthState()
      return { user: null, isAuthenticated: false }
    }

    if (!storedUser) {
      return { user: null, isAuthenticated: false }
    }

    const parsedUser = JSON.parse(storedUser) as unknown

    if (!isValidUser(parsedUser)) {
      clearAuthState()
      return { user: null, isAuthenticated: false }
    }

    return { user: parsedUser, isAuthenticated: true }
  } catch (error) {
    console.error('Failed to load auth state', error)
    clearAuthState()
    return { user: null, isAuthenticated: false }
  }
}

