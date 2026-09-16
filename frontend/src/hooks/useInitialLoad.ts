import { useAppSelector } from '@/app/hooks'
import { useGetMeQuery } from '@/features/auth/auth.api.ts'
import { selectIsInitializing, selectIsAuthenticated } from '@/features/auth/auth.slice'

/**
 * A custom hook to manage the initial loading state of the application.
 * It encapsulates all essential queries that must complete before the UI is shown.
 */
export function useInitialLoad() {
  const isAuthInitializing = useAppSelector(selectIsInitializing)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)

  const { isLoading: isSessionLoading } = useGetMeQuery(undefined, {
    skip: !isAuthenticated,
    selectFromResult: ({ isLoading }) => ({ isLoading }),
  })

  return {
    isLoading: isAuthInitializing || isSessionLoading,
  }
}