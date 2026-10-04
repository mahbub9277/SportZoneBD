import { useEffect } from 'react'
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

  const { isLoading: isRefreshLoading, isSuccess: isRefreshSuccessful, isError: isRefreshError } = useRefreshSessionQuery(undefined, {
    skip: isBootstrapBlocked,
    refetchOnMountOrArgChange: true,
  })

  const { data: sessionUser, isLoading: isSessionLoading, isFetching: isSessionFetching, isSuccess: isSessionSuccessful, isError: isSessionError } = useGetMeQuery(undefined, {
    skip: isBootstrapBlocked || isRefreshLoading,
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

    if ((isRefreshLoading || isSessionLoading || isSessionFetching) && !hasAuthBootstrapLock()) {
      if (acquireAuthBootstrapLock()) bootstrapOwnedByThisTab = true
    }

    if (isRefreshLoading || isSessionLoading || isSessionFetching) {
      const timeoutId = window.setTimeout(() => {
        releaseAuthBootstrapLock()
        dispatch(setAuthInitializing(false))
      }, 8000)

      return () => window.clearTimeout(timeoutId)
    }
  }, [dispatch, isBootstrapBlocked, isRefreshError, isRefreshLoading, isRefreshSuccessful, isSessionError, isSessionFetching, isSessionLoading, isSessionSuccessful, sessionUser, shouldAttemptBootstrap])

  return {
    isLoading: isAuthInitializing && shouldAttemptBootstrap,
  }
}
