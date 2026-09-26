import { fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { Mutex } from 'async-mutex'
import { createAction } from '@reduxjs/toolkit'

// Mutex to ensure only one token refresh is in progress at a time
const mutex = new Mutex()
const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '')

const baseQuery = fetchBaseQuery({
  baseUrl: apiBaseUrl,
  credentials: 'include',
})

// Create a generic action to signal that the user is unauthenticated.
// We will listen for this in the authSlice to trigger a logout.
export const unauthenticated = createAction<string | undefined>('auth/unauthenticated')
export const accountRestricted = createAction<string | undefined>('auth/accountRestricted')

export const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  // Wait for any ongoing re-authentication to complete
  await mutex.waitForUnlock()
  let result = await baseQuery(args, api, extraOptions)

  const requestUrl = typeof args === 'string' ? args : args.url
  const authState = (api.getState() as { auth?: { isAuthenticated?: boolean } }).auth
  const isAuthenticated = authState?.isAuthenticated === true
  if (result.error?.status === 403 && requestUrl.includes('/auth/me')) {
    api.dispatch(accountRestricted(
      typeof result.error.data === 'object' && result.error.data !== null && 'message' in result.error.data
        ? String(result.error.data.message)
        : 'Your account is restricted. Please contact an administrator.',
    ))
  }

  if (result.error && result.error.status === 401) {
    // If the refresh endpoint itself fails, we should just log out.
    const isRefreshRequest = (typeof args === 'string' ? args : args.url).includes('/auth/refresh')
    if (!isAuthenticated && !isRefreshRequest) {
      return result
    }
    if (isRefreshRequest) {
      // The refresh token is invalid or expired. Dispatch the unauthenticated action.
      const message = 'Your session has expired. Please log in again.'
      api.dispatch(unauthenticated(message))
      return result
    }

    if (!mutex.isLocked()) {
      const release = await mutex.acquire()
      try {
        // The refresh token is in an httpOnly cookie, so we don't need to send a body.
        const refreshResult = await baseQuery(
          { url: '/auth/refresh', method: 'POST' },
          api,
          extraOptions,
        )

        if (refreshResult.data) {
          // The backend has rotated the httpOnly cookies. Retry the original request.
          result = await baseQuery(args, api, extraOptions) // Re-run the original query with the new token
        } else {
          const message = 'Your session has expired. Please log in again.'
          api.dispatch(unauthenticated(message))
        }
      } finally {
        // Release the mutex so other requests can proceed.
        release()
      }
    } else {
      // Another request is already refreshing the token, wait for it to complete
      await mutex.waitForUnlock()
      result = await baseQuery(args, api, extraOptions)
    }
  }

  return result
}