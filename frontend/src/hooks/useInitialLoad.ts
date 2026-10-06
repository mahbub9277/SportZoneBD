import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import { useGetMeQuery, useRefreshSessionQuery } from '@/features/auth/auth.api.ts'
import { selectIsAuthenticated, selectIsInitializing, setAuthInitializing } from '@/features/auth/auth.slice'
import {
  acquireAuthBootstrapLock,
  hasAuthBootstrapHint,
  hasAuthBootstrapLock,
  releaseAuthBootstrapLock,
} from '@/features/auth/storage'

/**
 * The bootstrap lock exists so another tab (or the Google callback page) does not repeat the
 * bootstrap. A tab must never treat the lock it created itself as a skip, otherwise acquiring the
 * lock would cancel its own in-flight bootstrap. Ownership is tracked per JS context.
 */
let bootstrapOwnedByThisTab = false

/**
 * How long the splash may cover the application while the session is being restored.
 *
 * A warm backend answers the bootstrap in a few hundred milliseconds, so the splash normally never
 * reaches this budget. It only matters for a cold or unreachable backend, where blocking the whole
 * application for the full safety timeout would be worse than showing the shell early: public
 * routes keep working, protected routes show their own short authentication state, and the session
 * still settles in the background.
 *
 * The budget is one-way per page load: the initializing state is only ever cleared, never set again,
 * so the splash cannot come back once it has been released.
 */
const AUTH_SPLASH_BUDGET_MS = 2500

/**
 * Last-resort bound on the bootstrap itself. A request that never settles must not leave the
 * application in its initializing state, so it is released as a guest instead of hanging forever.
 */
const AUTH_BOOTSTRAP_SAFETY_TIMEOUT_MS = 8000

/**
 * A custom hook to manage the initial loading state of the application.
 * It encapsulates all essential queries that must complete before the UI is shown.
 */
export function useInitialLoad() {
  const dispatch = useAppDispatch()
  const isAuthInitializing = useAppSelector(selectIsInitializing)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const shouldAttemptBootstrap = !isAuthenticated && hasAuthBootstrapHint()
  // Only a lock owned by another context blocks the bootstrap. A lock this tab created itself must
  // not disable its own queries, and a freshly mounted subscription (isUninitialized) is not a skip.
  const isBootstrapBlocked = !shouldAttemptBootstrap || (hasAuthBootstrapLock() && !bootstrapOwnedByThisTab)

  const [isSplashBudgetSpent, setIsSplashBudgetSpent] = useState(false)

  // The single round trip that restores a session: the refresh endpoint returns the profile when it
  // is asked for it, which removes the follow-up /auth/me request from startup entirely.
  const { isLoading: isRefreshLoading, isSuccess: isRefreshSuccessful, isError: isRefreshError } = useRefreshSessionQuery({ includeUser: true }, {
    skip: isBootstrapBlocked,
    refetchOnMountOrArgChange: true,
  })

  const { data: sessionUser, isLoading: isSessionLoading, isFetching: isSessionFetching, isSuccess: isSessionSuccessful, isError: isSessionError } = useGetMeQuery(undefined, {
    // Only needed when the refresh could not hand back a profile (an older cached response or a
    // failed profile lookup), so it is skipped as soon as the refresh authenticated the user.
    skip: isBootstrapBlocked || isRefreshLoading || isAuthenticated,
    selectFromResult: ({ data, isError, isFetching, isLoading, isSuccess }) => ({
      data,
      isError,
      isFetching,
      isLoading,
      isSuccess,
    }),
  })

  useEffect(() => {
    if (!shouldAttemptBootstrap) {
      bootstrapOwnedByThisTab = false
      releaseAuthBootstrapLock()
      if (isAuthInitializing) {
        dispatch(setAuthInitializing(false))
      }
      return
    }

    if (!hasAuthBootstrapLock() && acquireAuthBootstrapLock()) {
      bootstrapOwnedByThisTab = true
    }
  }, [dispatch, isAuthInitializing, isBootstrapBlocked, shouldAttemptBootstrap])

  useEffect(() => {
    if (!isAuthInitializing || !shouldAttemptBootstrap) return

    const timeoutId = window.setTimeout(() => setIsSplashBudgetSpent(true), AUTH_SPLASH_BUDGET_MS)
    return () => window.clearTimeout(timeoutId)
  }, [isAuthInitializing, shouldAttemptBootstrap])

  useEffect(() => {
    if (!shouldAttemptBootstrap) return

    // Both bootstrap queries are skipped for this mount (another mount owns the lock), so no
    // loading/success/error state will ever arrive and initialization must terminate. A freshly
    // mounted subscription reports isUninitialized, which is NOT a skip, so the explicit
    // isBootstrapBlocked evidence is required: without the lock the requests are simply starting.
    const bootstrapNeverStarted = !isRefreshLoading && !isRefreshSuccessful && !isRefreshError
      && !isSessionLoading && !isSessionFetching && !isSessionSuccessful && !isSessionError && !sessionUser
    if (isBootstrapBlocked && bootstrapNeverStarted) {
      // Hand the bootstrap over to this tab instead of staying anonymous for the whole session.
      releaseAuthBootstrapLock()
      dispatch(setAuthInitializing(false))
      return
    }

    if (!isRefreshLoading && (isRefreshSuccessful || isRefreshError) && !isSessionLoading && !isSessionFetching && (sessionUser || isSessionSuccessful || isSessionError)) {
      releaseAuthBootstrapLock()
      dispatch(setAuthInitializing(false))
      return
    }

    // The refresh alone is enough evidence once it restored the profile; there is nothing left to
    // wait for, so the application is not kept behind the splash for the /auth/me request.
    if (isAuthenticated && !isRefreshLoading && !isSessionLoading && !isSessionFetching) {
      releaseAuthBootstrapLock()
      dispatch(setAuthInitializing(false))
      return
    }

    if ((isRefreshLoading || isSessionLoading || isSessionFetching) && !hasAuthBootstrapLock()) {
      if (acquireAuthBootstrapLock()) bootstrapOwnedByThisTab = true
    }

    if (isRefreshLoading || isSessionLoading || isSessionFetching) {
      const timeoutId = window.setTimeout(() => {
        releaseAuthBootstrapLock()
        dispatch(setAuthInitializing(false))
      }, AUTH_BOOTSTRAP_SAFETY_TIMEOUT_MS)

      return () => window.clearTimeout(timeoutId)
    }
  }, [dispatch, isAuthenticated, isBootstrapBlocked, isRefreshError, isRefreshLoading, isRefreshSuccessful, isSessionError, isSessionFetching, isSessionLoading, isSessionSuccessful, sessionUser, shouldAttemptBootstrap])

  return {
    isLoading: isAuthInitializing && shouldAttemptBootstrap && !isSplashBudgetSpent,
  }
}
