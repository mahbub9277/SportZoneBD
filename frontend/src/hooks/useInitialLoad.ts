import { useAppSelector } from '@/app/hooks'
import { useGetMeQuery, useRefreshSessionQuery } from '@/features/auth/auth.api.ts'
import { selectCurrentToken, selectIsAuthenticated, selectIsInitializing } from '@/features/auth/auth.slice'

/**
 * A custom hook to manage the initial loading state of the application.
 * It encapsulates all essential queries that must complete before the UI is shown.
 */
export function useInitialLoad() {
  const isAuthInitializing = useAppSelector(selectIsInitializing)
  const accessToken = useAppSelector(selectCurrentToken)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)

  const { isLoading: isRefreshLoading } = useRefreshSessionQuery(undefined, {
    skip: Boolean(accessToken) || !isAuthenticated,
  })

  const { isLoading: isSessionLoading } = useGetMeQuery(undefined, {
    skip: !accessToken,
    selectFromResult: ({ isLoading }) => ({ isLoading }),
  })

  return {
    isLoading: isAuthInitializing || isRefreshLoading || isSessionLoading,
  }
}