import type { PropsWithChildren } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { store } from '@/app/store'
import ErrorBoundary from '@/components/ErrorBoundary'
import { NotificationContainer } from '@/features/notifications/NotificationContainer'

export default function AppProvider({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <ReduxProvider store={store}>
        <NotificationContainer />
        {children}
      </ReduxProvider>
    </ErrorBoundary>
  )
}