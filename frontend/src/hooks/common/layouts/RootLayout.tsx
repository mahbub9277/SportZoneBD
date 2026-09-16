import { Outlet } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { GlobalLoadingIndicator } from '../../../components/shared/GlobalLoadingIndicator';
import { useLogoutMutation } from '../../../features/auth/auth.api.ts';
import { useAppDispatch, useAppSelector } from '../../../app/hooks';
import { logout, selectAccountStatus, selectAccountStatusMessage, selectIsAuthenticated } from '../../../features/auth/authSlice';
import { PopupDisplay } from '../../../components/shared/PopupDisplay';

/**
 * This component handles the initial user session check.
 */
const SessionCheck = () => {
  return null; // This component does not render anything.
};

const AccountRestrictionScreen = () => {
  const dispatch = useAppDispatch()
  const [logoutRequest, { isLoading }] = useLogoutMutation()
  const status = useAppSelector(selectAccountStatus)
  const message = useAppSelector(selectAccountStatusMessage)

  if (!status) return null

  const handleLogout = async () => {
    try {
      await logoutRequest().unwrap()
    } finally {
      dispatch(logout())
    }
  }

  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center bg-surface p-6">
      <section className="w-full max-w-lg rounded-3xl border border-border bg-surface-soft p-8 text-center shadow-xl">
        <ShieldAlert className="mx-auto h-12 w-12 text-danger" aria-hidden="true" />
        <p className="mt-5 text-sm font-semibold uppercase tracking-[0.2em] text-danger">Account {status}</p>
        <h1 className="mt-3 text-3xl font-semibold text-text-primary">Access temporarily unavailable</h1>
        <p className="mt-3 text-text-muted">{message}</p>
        <Button className="mt-6" onClick={() => void handleLogout()} disabled={isLoading}>
          {isLoading ? 'Signing out...' : 'Sign out'}
        </Button>
      </section>
    </main>
  )
}

const RootLayout = () => {
  return (
    <>
      <SessionCheck />
      <GlobalLoadingIndicator />
      <PopupDisplay />
      <AccountRestrictionScreen />
      <Outlet />
    </>
  );
};

export default RootLayout;