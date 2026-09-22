import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import { useGetMeQuery, useRefreshSessionQuery } from '@/features/auth/auth.api.ts'
import { selectCurrentToken, selectIsAuthenticated, selectIsInitializing, setAuthInitializing } from '@/features/auth/auth.slice'

/**
 * A custom hook to manage the initial loading state of the application.
 * It encapsulates all essential queries that must complete before the UI is shown.
 */
export function useInitialLoad() {
  const dispatch = useAppDispatch()
  const isAuthInitializing = useAppSelector(selectIsInitializing)
  const accessToken = useAppSelector(selectCurrentToken)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)

  const { isLoading: isRefreshLoading, isSuccess: isRefreshSuccessful, isError: isRefreshError } = useRefreshSessionQuery(undefined, {
    skip: Boolean(accessToken) || !isAuthenticated,
  })

  const { data: sessionUser, isLoading: isSessionLoading, isFetching: isSessionFetching, isSuccess: isSessionSuccessful, isError: isSessionError } = useGetMeQuery(undefined, {
    skip: !accessToken,
    selectFromResult: ({ data, isError, isFetching, isLoading, isSuccess }) => ({
      data,
      isError,
      isFetching,
      isLoading,
      isSuccess,
    }),
  })

  useEffect(() => {
    if (!isAuthenticated && !accessToken) {
      dispatch(setAuthInitializing(false))
      return
    }

    if (isAuthenticated && !accessToken) {
      if (!isRefreshLoading && (isRefreshSuccessful || isRefreshError)) dispatch(setAuthInitializing(false))
      return
    }

    if (accessToken && !isSessionLoading && !isSessionFetching && (sessionUser || isSessionSuccessful || isSessionError)) {
      dispatch(setAuthInitializing(false))
    }
  }, [accessToken, dispatch, isAuthenticated, isRefreshError, isRefreshLoading, isRefreshSuccessful, isSessionError, isSessionFetching, isSessionLoading, isSessionSuccessful, sessionUser])

  return {
    isLoading: isAuthInitializing || isRefreshLoading || isSessionLoading,
  }
}