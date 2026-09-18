/* eslint-disable react-refresh/only-export-components */
import { createBrowserRouter, Navigate, Outlet, useNavigate, type ActionFunctionArgs, redirect } from 'react-router-dom'
import { lazy, useEffect, type ComponentType } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'

// Layouts
import RootLayout from '@/hooks/common/layouts/RootLayout'
import AuthLayout from '@/hooks/common/layouts/AuthLayout'

import { store } from '@/app/store'
import { authApi } from '@/features/auth/auth.api.ts'
import { setAuthInitializing, setCredentials } from '@/features/auth/authSlice'
import { useGetMeQuery } from '@/features/auth/auth.api'
// Lazy-loaded Pages
const lazyRoute = (factory: () => Promise<Record<string, unknown>>, exportName: string) =>
  lazy(async () => {
    const module = (await factory()) as Record<string, unknown>
    const component = (module.default ?? module[exportName]) as ComponentType<Record<string, unknown>> | undefined

    if (!component) {
      throw new Error(`Route export "${exportName}" was not found.`)
    }

    return { default: component }
  })

const HomePage = lazyRoute(() => import('@/features/home/HomePage'), 'HomePage')
const LoginPage = lazyRoute(() => import('@/pages/auth/LoginPage'), 'LoginPage')
const UserLayout = lazyRoute(() => import('@/hooks/common/layouts/UserLayout'), 'UserLayout')
const AdminLayout = lazyRoute(() => import('@/hooks/common/layouts/AdminLayout'), 'default')
const AdminLoginPage = lazyRoute(() => import('@/pages/admin/AdminLoginPage'), 'AdminLoginPage')
const AdminDashboardPage = lazyRoute(() => import('@/pages/admin/DashboardPage'), 'AdminDashboardPage')
const MatchManagementPage = lazyRoute(() => import('@/pages/admin/MatchManagementPage'), 'MatchManagementPage')
const UserManagementPage = lazyRoute(() => import('@/pages/admin/UserManagementPage'), 'UserManagementPage')
const AdminProfilePage = lazyRoute(() => import('@/pages/admin/AdminProfilePage'), 'AdminProfilePage')
const RolesManagementPage = lazyRoute(() => import('@/pages/admin/RolesManagementPage'), 'RolesManagementPage')
const PremiumUsersPage = lazyRoute(() => import('@/pages/admin/premium-users/PremiumUsersPage'), 'PremiumUsersPage')
const ArchivedUsersPage = lazyRoute(() => import('@/pages/admin/ArchivedUsersPage'), 'ArchivedUsersPage')
const PermissionsManagementPage = lazyRoute(() => import('@/pages/admin/PermissionsManagementPage'), 'PermissionsManagementPage')
const SubscriptionPlanManagementPage = lazyRoute(() => import('@/pages/admin/SubscriptionPlanManagementPage'), 'SubscriptionPlanManagementPage')
const PaymentsManagementPage = lazyRoute(() => import('@/pages/admin/PaymentsManagementPage'), 'PaymentsManagementPage')
const ManualVerificationPage = lazyRoute(() => import('@/pages/admin/ManualVerificationPage'), 'ManualVerificationPage')
const StreamsManagementPage = lazyRoute(() => import('@/pages/admin/StreamsManagementPage'), 'StreamsManagementPage')
const LiveMatchesManagementPage = lazyRoute(() => import('@/pages/admin/LiveMatchesManagementPage'), 'LiveMatchesManagementPage')
const FinishedMatchesManagementPage = lazyRoute(() => import('@/pages/admin/FinishedMatchesManagementPage'), 'FinishedMatchesManagementPage')
const UpcomingMatchesManagementPage = lazyRoute(() => import('@/pages/admin/UpcomingMatchesManagementPage'), 'UpcomingMatchesManagementPage')
const HighlightsManagementPage = lazyRoute(() => import('@/pages/admin/HighlightsManagementPage'), 'HighlightsManagementPage')
const AdvertisementsManagementPage = lazyRoute(() => import('@/pages/admin/AdvertisementsManagementPage'), 'AdvertisementsManagementPage')
const PopupManagerPage = lazyRoute(() => import('@/pages/admin/PopupManagerPage'), 'PopupManagerPage')
const PushNotificationsManagementPage = lazyRoute(() => import('@/pages/admin/PushNotificationsManagementPage'), 'PushNotificationsManagementPage')
const EmailNotificationsManagementPage = lazyRoute(() => import('@/pages/admin/EmailNotificationsManagementPage'), 'EmailNotificationsManagementPage')
const AdminSettingsPage = lazyRoute(() => import('@/pages/admin/AdminSettingsPage'), 'AdminSettingsPage')
const ReportsManagementPage = lazyRoute(() => import('@/pages/admin/ReportsManagementPage'), 'ReportsManagementPage')
const AuditLogsManagementPage = lazyRoute(() => import('@/pages/admin/AuditLogsManagementPage'), 'AuditLogsManagementPage')
const ActivityLogsManagementPage = lazyRoute(() => import('@/pages/admin/ActivityLogsManagementPage'), 'ActivityLogsManagementPage')
const StorageManagementPage = lazyRoute(() => import('@/pages/admin/StorageManagementPage'), 'StorageManagementPage')
const AnalyticsPage = lazyRoute(() => import('@/pages/admin/AnalyticsPage'), 'AnalyticsPage')
const NotificationsPage = lazyRoute(() => import('@/pages/NotificationsPage'), 'NotificationsPage')
const UserSettingsPage = lazyRoute(() => import('@/pages/SettingsPage'), 'SettingsPage')
const ReportsPage = lazyRoute(() => import('@/pages/ReportsPage'), 'ReportsPage')
const AdvertisementsPage = lazyRoute(() => import('@/pages/AdvertisementsPage'), 'AdvertisementsPage')
const AdvertisementInterstitialPage = lazyRoute(() => import('@/pages/AdvertisementInterstitialPage'), 'AdvertisementInterstitialPage')
const ApiSettingsPage = lazyRoute(() => import('@/pages/admin/ApiSettingsPage'), 'ApiSettingsPage')
const WebsiteSettingsPage = lazyRoute(() => import('@/pages/admin/WebsiteSettingsPage'), 'WebsiteSettingsPage')
const BackupPage = lazyRoute(() => import('@/pages/admin/BackupPage'), 'BackupPage')
const SystemLogsPage = lazyRoute(() => import('@/pages/admin/SystemLogsPage'), 'SystemLogsManagementPage')
const PaymentHistoryPage = lazyRoute(() => import('@/pages/PaymentHistoryPage'), 'PaymentHistoryPage')
const ProfilePage = lazyRoute(() => import('@/pages/user/ProfilePage'), 'ProfilePage')
const UnauthorizedPage = lazyRoute(() => import('@/features/errors/UnauthorizedPage'), 'UnauthorizedPage')
const NotFoundPage = lazyRoute(() => import('@/features/errors/NotFoundPage'), 'NotFoundPage')
const AllMatchesPage = lazyRoute(() => import('@/pages/matches/AllMatchesPage'), 'AllMatchesPage')
const MatchPage = lazyRoute(() => import('@/pages/matches/MatchPage'), 'MatchPage')
const VerifyEmailPage = lazyRoute(() => import('@/pages/auth/VerifyEmailPage'), 'VerifyEmailPage')
const ChannelManagementPage = lazyRoute(() => import('@/pages/admin/ChannelManagementPage'), 'ChannelManagementPage')
const EventManagementPage = lazyRoute(() => import('@/pages/admin/EventManagementPage'), 'EventManagementPage')
const BannerManagementPage = lazyRoute(() => import('@/pages/admin/BannerManagementPage'), 'BannerManagementPage')
const ForgotPasswordPage = lazyRoute(() => import('@/pages/auth/ForgotPasswordPage'), 'ForgotPasswordPage')
const ResetPasswordPage = lazyRoute(() => import('@/pages/auth/ResetPasswordPage'), 'ResetPasswordPage')
const TermsOfServicePage = lazyRoute(() => import('@/pages/TermsOfServicePage'), 'TermsOfServicePage')
const PrivacyPolicyPage = lazyRoute(() => import('@/pages/PrivacyPolicyPage'), 'PrivacyPolicyPage')
const ChannelsPage = lazyRoute(() => import('@/pages/explore/ChannelsPage'), 'ChannelsPage')
const CategoriesPage = lazyRoute(() => import('@/pages/explore/CategoriesPage'), 'CategoriesPage')
const CategoryChannelsPage = lazyRoute(() => import('@/pages/explore/CategoryChannelsPage'), 'CategoryChannelsPage')
const FavoritesPage = lazyRoute(() => import('@/pages/FavoritesPage'), 'FavoritesPage')
const WatchChannelPage = lazyRoute(() => import('@/pages/explore/WatchChannelPage'), 'WatchChannelPage')
const HighlightsPage = lazyRoute(() => import('@/pages/explore/HighlightsPage'), 'HighlightsPage')
const StandingsPage = lazyRoute(() => import('@/pages/explore/StandingsPage'), 'StandingsPage')
const SubscriptionsPage = lazyRoute(() => import('@/pages/SubscriptionsPage'), 'SubscriptionsPage')
const EventPage = lazyRoute(() => import('@/pages/events/EventPage'), 'EventPage')
import type { RootState } from '@/app/store' // Import RootState from store
import type { User } from '@/features/auth/auth.types'

/**
 * A component for guest-only routes.
 * It redirects authenticated users to the home page.
 */
const GuestRoute = () => {
  const { isAuthenticated } = useAppSelector((state: RootState) => state.auth)
  return isAuthenticated ? <Navigate to="/" replace /> : <Outlet />
}

const GoogleAuthCallback = () => {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { data: user, isLoading, isFetching, isError } = useGetMeQuery()

  useEffect(() => {
    if (isError) {
      navigate('/login?error=google-session-failed', { replace: true })
    } else if (!isLoading && !isFetching) {
      if (user) {
        dispatch(setCredentials({ user, rememberMe: true }))
        navigate('/profile', { replace: true })
      }
    }
  }, [dispatch, isError, isFetching, isLoading, navigate, user])

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-soft/80 px-5 py-4 text-sm text-text-muted" role="status" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        Signing you in with Google...
      </div>
    </main>
  )
}

async function adminLoginAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  store.dispatch(setAuthInitializing(true))

  try {
    const result = await store.dispatch(authApi.endpoints.adminLogin.initiate({ email, password }))

    if ('data' in result) {
      const payload = result.data as { data?: { user?: unknown }; user?: unknown }
      const user = payload?.data?.user ?? payload?.user ?? null

      if (user && typeof user === 'object') {
        // Admin sessions should survive reloads and browser restarts.
        store.dispatch(setCredentials({ user: user as User, rememberMe: true }))
        // On successful login, redirect to the admin dashboard.
        return redirect('/admin');
      }
    }

    // If login fails, return the error message to be displayed on the page.
    const errorMessage = (result.error as { data?: { message?: string } } | undefined)?.data?.message || 'Invalid admin credentials.'
    return { error: errorMessage }
  } catch {
    return { error: 'An unexpected error occurred.' }
  } finally {
    store.dispatch(setAuthInitializing(false))
  }
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />, // This will render GlobalLoadingIndicator and then its children
    children: [
      {
        element: <UserLayout />, // User-facing layout — public and authenticated pages
        children: [
          { index: true, element: <HomePage /> },
          { path: 'matches', element: <AllMatchesPage /> },
          { path: 'matches/:id', element: <MatchPage /> },
          { path: 'watch/:channelId', element: <WatchChannelPage /> },
          { path: 'channels', element: <ChannelsPage /> },
          { path: 'categories', element: <CategoriesPage /> },
          { path: 'categories/:categoryId', element: <CategoryChannelsPage /> },
          { path: 'favorites', element: <FavoritesPage /> },
          { path: 'auth/google/callback', element: <GoogleAuthCallback /> },
          { path: 'highlights', element: <HighlightsPage /> },
          { path: 'standings', element: <StandingsPage /> },
          { path: 'terms-of-service', element: <TermsOfServicePage /> },
          { path: 'privacy-policy', element: <PrivacyPolicyPage /> },
          { path: 'subscriptions', element: <SubscriptionsPage /> },
          { path: 'events/:slug', element: <EventPage /> },
          { path: 'advertisements', element: <AdvertisementsPage /> },
          { path: 'advertisements/interstitial', element: <AdvertisementInterstitialPage /> },
          {
            element: <ProtectedRoute />,
            children: [
              { path: 'reports', element: <ReportsPage /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: 'profile/settings', element: <UserSettingsPage /> },
              { path: 'profile/payment-history', element: <PaymentHistoryPage/> },
              { path: 'notifications', element: <NotificationsPage /> },
            ],
          },
        ],
      },
      {
        element: <GuestRoute />,
        children: [
          {
            path: '/login',
            element: <AuthLayout />,
            children: [{ index: true, element: <LoginPage /> }],
          },
          { path: '/verify-email', element: <VerifyEmailPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
          { path: '/reset-password', element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <ProtectedRoute allowedRoles={['admin', 'super_admin']} loginPath="/admin/login" />,
        children: [
          {
            path: '/admin',
            element: <AdminLayout />,
            children: [
              { index: true, element: <AdminDashboardPage /> },
              { path: 'profile', element: <AdminProfilePage /> },
              { path: 'users', element: <UserManagementPage /> },
              { path: 'matches', element: <MatchManagementPage /> },
              { path: 'channels', element: <ChannelManagementPage /> },
              { path: 'events', element: <EventManagementPage /> },
              { path: 'banner-manager', element: <BannerManagementPage /> },
              { path: 'roles', element: <RolesManagementPage /> },
              { path: 'permissions', element: <PermissionsManagementPage /> },
              { path: 'settings', element: <AdminSettingsPage /> },
              { path: 'analytics', element: <AnalyticsPage /> },
              { path: 'premium-users', element: <PremiumUsersPage /> },
              { path: 'archived-users', element: <ArchivedUsersPage /> },
              { path: 'subscription-plans', element: <SubscriptionPlanManagementPage /> },
              { path: 'payments', element: <PaymentsManagementPage /> },
              { path: 'manual-verification', element: <ManualVerificationPage /> }, 
              { path: 'streams', element: <StreamsManagementPage /> },
              { path: 'live-matches', element: <LiveMatchesManagementPage /> },
              { path: 'upcoming-matches', element: <UpcomingMatchesManagementPage /> }, 
              { path: 'finished-matches', element: <FinishedMatchesManagementPage /> },
              { path: 'highlights', element: <HighlightsManagementPage /> },
              { path: 'advertisements', element: <AdvertisementsManagementPage /> },
              { path: 'popup-manager', element: <PopupManagerPage /> },
              { path: 'push-notifications', element: <PushNotificationsManagementPage /> },
              { path: 'email-notifications', element: <EmailNotificationsManagementPage /> },
              { path: 'reports', element: <ReportsManagementPage /> },
              { path: 'activity-logs', element: <ActivityLogsManagementPage /> },
              { path: 'logs', element: <Navigate to="/admin/audit-logs" replace /> },
              { path: 'storage', element: <StorageManagementPage /> },
              { path: 'audit-logs', element: <AuditLogsManagementPage /> },
              { path: 'api-settings', element: <ApiSettingsPage /> },
              { path: 'website-settings', element: <WebsiteSettingsPage /> },
              { path: 'general-settings', element: <AdminSettingsPage /> },
              { path: 'backup', element: <BackupPage /> },
              { path: 'system-logs', element: <SystemLogsPage /> },
            ],
          },
        ],
      },
      {
        // Route for users who are authenticated but not authorized for a specific page
        path: '/unauthorized', element: <UnauthorizedPage />,
      },
      {
        // Separate login route for admins
        path: '/admin/login',
        element: <AuthLayout />,
        action: adminLoginAction, // Add the action handler here
        Component: AdminLoginPage,
      },
    ], // All other routes become children of RootLayout
  },
  { path: '*', element: <NotFoundPage /> }
])