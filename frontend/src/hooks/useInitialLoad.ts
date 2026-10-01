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
 * A custom hook to manage the initial loading state of the application.
 * It encapsulates all essential queries that must complete before the UI is shown.
 */
export function useInitialLoad() {
  const dispatch = useAppDispatch()
  const isAuthInitializing = useAppSelector(selectIsInitializing)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const shouldAttemptBootstrap = !isAuthenticated && hasAuthBootstrapHint()
  const isBootstrapBlocked = !shouldAttemptBootstrap || hasAuthBootstrapLock()

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
      releaseAuthBootstrapLock()
      if (isAuthInitializing) {
        dispatch(setAuthInitializing(false))
      }
      return
    }

    if (!hasAuthBootstrapLock()) {
      acquireAuthBootstrapLock()
    }
  }, [dispatch, isAuthInitializing, shouldAttemptBootstrap])

  useEffect(() => {
    if (!shouldAttemptBootstrap) return

    if (!isRefreshLoading && (isRefreshSuccessful || isRefreshError) && !isSessionLoading && !isSessionFetching && (sessionUser || isSessionSuccessful || isSessionError)) {
      releaseAuthBootstrapLock()
      dispatch(setAuthInitializing(false))
      return
    }

    if ((isRefreshLoading || isSessionLoading || isSessionFetching) && !hasAuthBootstrapLock()) {
      acquireAuthBootstrapLock()
    }

    if (isRefreshLoading || isSessionLoading || isSessionFetching) {
      const timeoutId = window.setTimeout(() => {
        releaseAuthBootstrapLock()
        dispatch(setAuthInitializing(false))
      }, 8000)

      return () => window.clearTimeout(timeoutId)
    }
  }, [dispatch, isRefreshError, isRefreshLoading, isRefreshSuccessful, isSessionError, isSessionFetching, isSessionLoading, isSessionSuccessful, sessionUser, shouldAttemptBootstrap])

  return {
    isLoading: isAuthInitializing && shouldAttemptBootstrap,
  }
}
