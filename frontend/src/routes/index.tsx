/* eslint-disable react-refresh/only-export-components */
import { createBrowserRouter, Navigate, Outlet, useLocation, useNavigate, type ActionFunctionArgs, redirect } from 'react-router-dom'
import { lazy, useEffect, type ComponentType } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'

// Layouts
import RootLayout from '@/hooks/common/layouts/RootLayout'
import AuthLayout from '@/hooks/common/layouts/AuthLayout'

import { store } from '@/app/store'
import { authApi } from '@/features/auth/auth.api.ts'
import { selectIsAuthenticated, selectIsInitializing, setAuthInitializing, setCredentials } from '@/features/auth/authSlice'
import { useGetMeQuery } from '@/features/auth/auth.api'
import {
  acquireAuthBootstrapLock,
  hasAuthBootstrapHint,
  hasAuthBootstrapLock,
  releaseAuthBootstrapLock,
  setAuthBootstrapHint,
} from '@/features/auth/storage'
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
const ModeratorLoginPage = lazyRoute(() => import('@/pages/moderator/ModeratorLoginPage'), 'ModeratorLoginPage')
const StaffLoginPage = lazyRoute(() => import('@/pages/staff/StaffLoginPage'), 'StaffLoginPage')
const ModeratorLayout = lazyRoute(() => import('@/features/console/ModeratorLayout'), 'ModeratorLayout')
const StaffLayout = lazyRoute(() => import('@/features/console/StaffLayout'), 'StaffLayout')
const ConsoleHomePage = lazyRoute(() => import('@/features/console/ConsoleHomePage'), 'ConsoleHomePage')
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
const AboutPage = lazyRoute(() => import('@/features/pwa/AboutSportZoneBD'), 'AboutSportZoneBD')
const UserSettingsPage = lazyRoute(() => import('@/pages/SettingsPage'), 'SettingsPage')
const ReportsPage = lazyRoute(() => import('@/pages/ReportsPage'), 'ReportsPage')
const AdvertisementsPage = lazyRoute(() => import('@/pages/AdvertisementsPage'), 'AdvertisementsPage')
const AdvertisementInterstitialPage = lazyRoute(() => import('@/pages/AdvertisementInterstitialPage'), 'AdvertisementInterstitialPage')
const ApiSettingsPage = lazyRoute(() => import('@/pages/admin/ApiSettingsPage'), 'ApiSettingsPage')
const WebsiteSettingsPage = lazyRoute(() => import('@/pages/admin/WebsiteSettingsPage'), 'WebsiteSettingsPage')
const SystemLogsPage = lazyRoute(() => import('@/pages/admin/SystemLogsPage'), 'SystemLogsManagementPage')
const PaymentHistoryPage = lazyRoute(() => import('@/pages/PaymentHistoryPage'), 'PaymentHistoryPage')
const ProfilePage = lazyRoute(() => import('@/pages/user/ProfilePage'), 'ProfilePage')
const UnauthorizedPage = lazyRoute(() => import('@/features/errors/UnauthorizedPage'), 'UnauthorizedPage')
const NotFoundPage = lazyRoute(() => import('@/features/errors/NotFoundPage'), 'NotFoundPage')
const BadRequestPage = lazyRoute(() => import('@/features/errors/StatusPages'), 'BadRequestPage')
const SessionExpiredPage = lazyRoute(() => import('@/features/errors/StatusPages'), 'SessionExpiredPage')
const ForbiddenPage = lazyRoute(() => import('@/features/errors/StatusPages'), 'ForbiddenPage')
const ServerErrorPage = lazyRoute(() => import('@/features/errors/StatusPages'), 'ServerErrorPage')
const ServiceUnavailablePage = lazyRoute(() => import('@/features/errors/StatusPages'), 'ServiceUnavailablePage')
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
const TVModePage = lazyRoute(() => import('@/features/tv/TVModePage'), 'TVModePage')
const HighlightsPage = lazyRoute(() => import('@/pages/explore/HighlightsPage'), 'HighlightsPage')
const StandingsPage = lazyRoute(() => import('@/pages/explore/StandingsPage'), 'StandingsPage')
const SubscriptionsPage = lazyRoute(() => import('@/pages/SubscriptionsPage'), 'SubscriptionsPage')
const EventPage = lazyRoute(() => import('@/pages/events/EventPage'), 'EventPage')
import type { RootState } from '@/app/store' // Import RootState from store
import type { RouteObject } from 'react-router-dom'
import type { User } from '@/features/auth/auth.types'

/**
 * Wraps module routes so a user who lacks the matching permission is sent to the unauthorized page
 * instead of reaching a page whose API calls would all fail. The backend remains the authority; this
 * only makes direct URL access degrade cleanly.
 */
const withPermission = (permission: string, routes: RouteObject[]): RouteObject => ({
  element: <ProtectedRoute requiredPermissions={[permission]} />,
  children: routes,
})

/**
 * The project-management modules shared by the moderator and staff consoles. Each group is guarded by
 * the same permission the backend enforces on the endpoints those pages call.
 */
const consoleModuleRoutes = (): RouteObject[] => [
  withPermission('admin.matches.manage', [
    { path: 'matches', element: <MatchManagementPage /> },
    { path: 'live-matches', element: <LiveMatchesManagementPage /> },
    { path: 'upcoming-matches', element: <UpcomingMatchesManagementPage /> },
    { path: 'finished-matches', element: <FinishedMatchesManagementPage /> },
  ]),
  withPermission('admin.streams.manage', [{ path: 'streams', element: <StreamsManagementPage /> }]),
  withPermission('admin.highlights.manage', [{ path: 'highlights', element: <HighlightsManagementPage /> }]),
  withPermission('admin.channels.manage', [{ path: 'channels', element: <ChannelManagementPage /> }]),
  withPermission('admin.events.manage', [{ path: 'events', element: <EventManagementPage /> }]),
  withPermission('admin.banners.manage', [{ path: 'banner-manager', element: <BannerManagementPage /> }]),
]

/**
 * A component for guest-only routes.
 * It redirects authenticated users to the home page.
 */
const GuestRoute = () => {
  const location = useLocation()
  const { isAuthenticated, isInitializing } = useAppSelector((state: RootState) => state.auth)
  const isExplicitGuestRoute = ['/login', '/verify-email', '/forgot-password', '/reset-password'].includes(location.pathname)

  if (isInitializing && !isExplicitGuestRoute) return null
  return isAuthenticated ? <Navigate to="/" replace /> : <Outlet />
}

const GoogleAuthCallback = () => {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const isAuthInitializing = useAppSelector(selectIsInitializing)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const bootstrapLocked = hasAuthBootstrapLock()
  const { data: user, isLoading, isFetching, isError } = useGetMeQuery(undefined, {
    skip: isAuthInitializing || isAuthenticated || bootstrapLocked,
  })

  useEffect(() => {
    if (isAuthenticated) {
      dispatch(setAuthInitializing(false))
      navigate('/profile', { replace: true })
      return
    }

    if (!hasAuthBootstrapHint()) {
      setAuthBootstrapHint(true)
    }

    if (!hasAuthBootstrapLock()) {
      acquireAuthBootstrapLock()
    }
  }, [dispatch, isAuthenticated, isAuthInitializing, navigate])

  useEffect(() => {
    if (isAuthenticated) return

    if (isError) {
      releaseAuthBootstrapLock()
      dispatch(setAuthInitializing(false))
      navigate('/login?error=google-session-failed', { replace: true })
      return
    }

    if (!isLoading && !isFetching && user) {
      dispatch(setCredentials({ user, rememberMe: true }))
      releaseAuthBootstrapLock()
      navigate('/profile', { replace: true })
    }
  }, [dispatch, isAuthenticated, isError, isFetching, isLoading, navigate, user])

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
      // TV Mode is a separate experience: it renders its own full-viewport shell and therefore sits
      // beside UserLayout instead of inside it, so no header, sidebar, footer or bottom navigation.
      { path: 'tv', element: <TVModePage /> },
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
          { path: 'about', element: <AboutPage /> },
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
              { path: 'system-logs', element: <SystemLogsPage /> },
            ],
          },
        ],
      },
      {
        // The moderator console is its own route tree: a moderator never renders an admin layout, and
        // entering an admin URL directly is rejected by the admin guard above.
        element: <ProtectedRoute allowedExperiences={['moderator']} loginPath="/moderator/login" />,
        children: [
          {
            path: '/moderator',
            element: <ModeratorLayout />,
            children: [
              {
                index: true,
                element: (
                  <ConsoleHomePage
                    title="Moderator dashboard"
                    subtitle="Manage the matches, streams and channels your account has been granted."
                    emptyTitle="No modules assigned"
                    emptyMessage="Your moderator account does not currently have any modules assigned. Ask an administrator to review your role permissions."
                  />
                ),
              },
              { path: 'profile', element: <AdminProfilePage /> },
              ...consoleModuleRoutes(),
            ],
          },
        ],
      },
      {
        // Shared console for administrator-made custom roles (for example an editor).
        element: <ProtectedRoute allowedExperiences={['staff']} loginPath="/staff/login" />,
        children: [
          {
            path: '/staff',
            element: <StaffLayout />,
            children: [
              {
                index: true,
                element: (
                  <ConsoleHomePage
                    title="Staff dashboard"
                    subtitle="The tools your role has been granted."
                    emptyTitle="Access not configured"
                    emptyMessage="Your role does not grant access to any console modules yet. An administrator can add permissions to your role before you can use this console."
                  />
                ),
              },
              { path: 'profile', element: <AdminProfilePage /> },
              ...consoleModuleRoutes(),
            ],
          },
        ],
      },
      {
        // Route for users who are authenticated but not authorized for a specific page
        path: '/unauthorized', element: <UnauthorizedPage />,
      },
      { path: '/400', element: <BadRequestPage /> },
      { path: '/401', element: <SessionExpiredPage /> },
      { path: '/403', element: <ForbiddenPage /> },
      { path: '/500', element: <ServerErrorPage /> },
      { path: '/503', element: <ServiceUnavailablePage /> },
      {
        // Separate login route for admins
        path: '/admin/login',
        element: <AuthLayout />,
        action: adminLoginAction, // Add the action handler here
        Component: AdminLoginPage,
      },
      {
        // Dedicated login route for moderators.
        path: '/moderator/login',
        element: <AuthLayout />,
        Component: ModeratorLoginPage,
      },
      {
        // Shared login route for administrator-made custom roles.
        path: '/staff/login',
        element: <AuthLayout />,
        Component: StaffLoginPage,
      },
    ], // All other routes become children of RootLayout
  },
  { path: '*', element: <NotFoundPage /> }
])