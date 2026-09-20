import { createSlice, type PayloadAction, createSelector, isAnyOf } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'
import type { LoginResponse, User } from './auth.types'
import { loadAuthState, clearAuthState, saveAuthState } from './storage'
import { authApi } from './auth.api.ts'
import { accountRestricted, unauthenticated } from '../../app/api/baseQueryWithReauth'

export interface AuthState {
  isAuthenticated: boolean
  // The JWT token is best managed by httpOnly cookies for security.
  token: string | null
  user: User | null
  isInitializing: boolean
  accountStatus: 'active' | 'suspended' | 'banned' | 'deactivated' | null
  accountStatusMessage: string | null
}

const initialState: AuthState = {
  ...loadAuthState(),
  token: null, // Token is not persisted in localStorage for security
  isInitializing: true,
  accountStatus: null,
  accountStatusMessage: null,
}

function isLoginResponse(payload: LoginResponse | User): payload is LoginResponse {
  return 'user' in payload
}

/**
 * Extracts the user object from various possible API response shapes.
 * @param payload The payload from an RTK Query endpoint.
 * @returns The user object or null if not found.
 */
const extractUserFromPayload = (payload: LoginResponse | User): User => {
  return isLoginResponse(payload) ? payload.user : payload
}

/**
 * Handles successful authentication by updating state and persisting to storage.
 */
const handleAuthSuccess = (state: AuthState, { payload }: PayloadAction<LoginResponse | User>) => {
  const user = extractUserFromPayload(payload)

  state.user = user
  if (isLoginResponse(payload) && payload.accessToken) state.token = payload.accessToken
  state.isAuthenticated = true
  state.isInitializing = false
  state.accountStatus = null
  state.accountStatusMessage = null
}
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuthInitializing: (state, action: PayloadAction<boolean>) => {
      state.isInitializing = action.payload
    },
    setCredentials: (
      state,
      action: PayloadAction<{ user: User; rememberMe?: boolean; accessToken?: string }>,
    ) => {
      const { user, rememberMe = false, accessToken } = action.payload

      state.user = user
      if (accessToken) state.token = accessToken
      state.isAuthenticated = true
      state.isInitializing = false
      state.accountStatus = null
      state.accountStatusMessage = null
      saveAuthState(user, null, rememberMe)
    },
    setAccessToken: (state, action: PayloadAction<string | null>) => {
      state.token = action.payload
    },
    setUser: (state, action: PayloadAction<{ user: User }>) => {
      const { user } = action.payload

      state.user = user
      state.isAuthenticated = true
      state.isInitializing = false
      state.accountStatus = null
      state.accountStatusMessage = null
    },
    logout: (state) => {
      state.isAuthenticated = false
      state.token = null
      state.user = null
      state.isInitializing = false
      clearAuthState()
    },
  },
  extraReducers: (builder) => {
    builder
      // Matcher for endpoints that establish an authenticated session
      .addMatcher(
        isAnyOf( // Using isAnyOf for multiple successful auth endpoints
          authApi.endpoints.login.matchFulfilled,
          authApi.endpoints.adminLogin.matchFulfilled,
          authApi.endpoints.verifyEmail.matchFulfilled,
          authApi.endpoints.getMe.matchFulfilled,
        ),
        handleAuthSuccess,
      )
      .addMatcher(authApi.endpoints.refreshSession.matchFulfilled, (state, { payload }) => {
        state.token = payload.accessToken
      })
      // Matcher for when profile is updated, only updates the user object.
      .addMatcher(authApi.endpoints.updateProfile.matchFulfilled, (state, { payload }) => {
        const user = extractUserFromPayload(payload)
        if (user) {
          state.user = { ...state.user, ...user } as User
        }
      })
      // Matcher for when logout is complete or session is invalid
      .addMatcher(authApi.endpoints.logout.matchFulfilled, (state) => {
        // When the API logout succeeds, reset the state using the existing logout reducer.
        return authSlice.reducer(state, logout())
      })
      // Matcher for when getMe fails (e.g., invalid session)
      .addMatcher(authApi.endpoints.getMe.matchRejected, (state, action) => {
        // Only an unauthorized response proves that the session is invalid.
        if (action.payload && 'status' in action.payload && action.payload.status === 401) {
          return authSlice.reducer(state, logout())
        }
      })
      // Listener for the unauthenticated action from baseQueryWithReauth
      .addMatcher(unauthenticated.match, (state) => {
        return authSlice.reducer(state, logout())
      })
      .addMatcher(accountRestricted.match, (state, action) => {
        state.accountStatus = action.payload?.toLowerCase().includes('banned')
          ? 'banned'
          : action.payload?.toLowerCase().includes('deactivated')
            ? 'deactivated'
            : 'suspended'
        state.accountStatusMessage = action.payload ?? 'Your account is restricted. Please contact an administrator.'
        state.isAuthenticated = true
      })
  },
})

export const { setAuthInitializing, setCredentials, setAccessToken, setUser, logout } = authSlice.actions

export const selectIsAuthenticated = (state: RootState) => state.auth.isAuthenticated
export const selectCurrentToken = (state: RootState) => state.auth.token
export const selectCurrentUser = (state: RootState) => state.auth.user
export const selectAccountStatus = (state: RootState) => state.auth.accountStatus
export const selectAccountStatusMessage = (state: RootState) => state.auth.accountStatusMessage
export const selectIsInitializing = (state: RootState) => state.auth.isInitializing
export const selectIsPremiumSubscriber = createSelector([selectCurrentUser], (user) => {
  if (!user) return false
  const hasPremiumRole = user.roles?.some((role) => {
    const roleName = typeof role?.name === 'string' ? role.name : role?.role?.name
    return roleName === 'premium_user'
  })
  const expiresAt = user.subscription?.expiresAt ? new Date(user.subscription.expiresAt).getTime() : 0
  const hasActiveSubscription = user.subscription?.status === 'ACTIVE' && expiresAt > Date.now()
  return Boolean(hasActiveSubscription || (hasPremiumRole && expiresAt > Date.now()))
})

export const selectIsAdmin = createSelector([selectCurrentUser], (user) => {
  if (!user?.roles) return false
  // Check if the user has either 'admin' or 'super_admin' role
  return user.roles.some(
    (role) => role.name === 'admin' || role.name === 'super_admin',
  )
})

// Memoized selector for derived data (user permissions)
export const selectUserPermissions = createSelector(
  [selectCurrentUser],
  (user) => {
    // This calculation only runs if `user` object changes. The permissions array contains strings.
    return user?.permissions ?? []
  }
)

export default authSlice.reducer
