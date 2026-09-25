import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, BellRing, ChevronDown, Crown, Menu, MoonStar, Search, Settings, SunMedium, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/utils'
import { useAppSelector } from '../../app/hooks'
import { selectCurrentUser, selectIsAuthenticated } from '../../features/auth/auth.slice'
import { useTheme } from '../../hooks/useTheme'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/DropdownMenu'
import { useLogoutMutation } from '../../features/auth/auth.api.ts'
import { useGetUnreadNotificationCountQuery } from '../../features/notifications/notification.api'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/Avatar'
import { buildCloudinaryUrl } from '../../utils/cloudinary.ts'
import { SearchBox } from './SearchBox.tsx'
import { CommandKMenu } from '../../components/shared/CommandKMenu.tsx'
import localLogo from '../../assets/logo.png.webp'

const NotificationsPage = lazy(() => import('../../pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })))

interface HeaderProps {
  onMenuClick: () => void
  isMenuOpen?: boolean
}

export function Header({ onMenuClick, isMenuOpen = false }: HeaderProps) {
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const user = useAppSelector(selectCurrentUser)
  const [now, setNow] = useState(() => Date.now())
  const hasActiveSubscription = Boolean(user?.subscription && user.subscription.status === 'ACTIVE' && new Date(user.subscription.expiresAt).getTime() > now)
  const { theme, toggleTheme } = useTheme()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [logout] = useLogoutMutation()
  const { data: notificationData } = useGetUnreadNotificationCountQuery(undefined, {
    skip: !isAuthenticated,
  })
  const navigate = useNavigate()

  useEffect(() => {
    if (!user?.subscription) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [user?.subscription, user?.subscription?.expiresAt])

  useEffect(() => {
    if (!isNotificationsOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNotificationsOpen(false)
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isNotificationsOpen])

  const handleLogout = async () => {
    try {
      await logout().unwrap()
      navigate('/login')
    } catch (error) {
      console.error('Failed to logout:', error)
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-surface/90 shadow-[0_18px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
      <div className="mx-auto flex h-auto min-h-20 max-w-[1600px] items-center justify-between gap-3 px-3 py-3 sm:gap-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 shrink-0 rounded-2xl xl:hidden"
            onClick={onMenuClick}
            aria-label="Open sidebar"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-sidebar"
          >
            {isMenuOpen ? <X className="h-[1.85rem] w-[1.85rem]" /> : <Menu className="h-[1.85rem] w-[1.85rem]" />}
          </Button>

          <Link to="/" className="flex min-w-0 items-center gap-3" aria-label="Go to homepage">
            <div className="flex h-13 w-auto min-w-0 max-w-70 items-center justify-start overflow-visible sm:h-14 md:h-16">
              <img src={localLogo} alt="SportZoneBD logo" className="h-full w-auto max-w-none origin-left scale-200 object-contain object-left py-2 sm:scale-170" />
            </div>
          </Link>
        </div>

        <div className="hidden max-w-md flex-1 items-center gap-4 md:flex">
          <SearchBox onOpen={() => setIsSearchOpen(true)} />
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:hidden"
            onClick={() => setIsSearchOpen(true)}
            aria-label="Open search"
          >
            <Search className="h-6 w-6" />
          </Button>

          <Link
            to="/subscriptions"
            className="hidden items-center gap-2 rounded-full bg-linear-to-r from-yellow-400 to-yellow-500 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-black shadow-sm transition hover:brightness-105 sm:flex"
            aria-label="Go to premium plans"
          >
            <Crown className="h-3.5 w-3.5" />
            Premium
          </Link>

          <Button
            onClick={toggleTheme}
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 overflow-hidden rounded-full"
            aria-label="Toggle theme"
          >
            <SunMedium
              size={18}
              className={cn(
                'absolute inset-0 m-auto transition-all duration-300',
                theme === 'dark' ? 'scale-100 rotate-0 opacity-100' : 'scale-75 -rotate-90 opacity-0',
              )}
            />
            <MoonStar
              size={18}
              className={cn(
                'absolute inset-0 m-auto transition-all duration-300',
                theme === 'light' ? 'scale-100 rotate-0 opacity-100' : 'scale-75 rotate-90 opacity-0',
              )}
            />
          </Button>

          <div className="relative inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full"
              onClick={() => setIsNotificationsOpen((isOpen) => !isOpen)}
              aria-label="View notifications"
              aria-expanded={isNotificationsOpen}
              aria-controls="notifications-panel"
            >
              <Bell className={cn('h-7 w-7 transition-all', notificationData && notificationData.count > 0 && 'fill-accent text-accent')} />
            </Button>
            {notificationData && notificationData.count > 0 && (
              <span className="pointer-events-none absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                {notificationData.count > 9 ? '9+' : notificationData.count}
              </span>
            )}
          </div>

          {isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex h-auto items-center gap-2 rounded-full px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.avatar ? buildCloudinaryUrl(user.avatar) : undefined} alt={user.fullName ?? ''} />
                      <AvatarFallback name={user.fullName ?? user.email ?? ''} />
                    </Avatar>
                    {hasActiveSubscription && <Crown className="h-4 w-4 text-amber-500 drop-shadow-[0_0_6px_rgba(245,158,11,0.45)] dark:text-amber-400" aria-label="Premium membership active" />}
                    <span className="hidden text-sm font-medium text-text-primary sm:inline">{user.fullName}</span>
                    <ChevronDown className="h-4 w-4 text-text-muted" />
                  </span>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent className="w-60" align="end">
                <DropdownMenuLabel className="font-normal">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-text-primary">{user.fullName}</p>
                    <p className="text-xs text-text-muted">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/profile" className="flex items-center gap-2">
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/profile/payment-history" className="flex items-center gap-2">
                    Payment History
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/profile/settings" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/matches" className="flex items-center gap-2">
                    My Matches
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2">
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              asChild
              variant="outline"
              className="rounded-full px-4"
            >
              <Link
                to="/login"
                onPointerEnter={() => void import('../../pages/auth/LoginPage')}
                onFocus={() => void import('../../pages/auth/LoginPage')}
              >
                Sign In
              </Link>
            </Button>
          )}
        </div>
      </div>

      <CommandKMenu isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      {isNotificationsOpen && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]"
            onClick={() => setIsNotificationsOpen(false)}
          />
          <aside id="notifications-panel" aria-label="Notifications panel" className="fixed right-3 top-1/2 z-50 h-[min(72dvh,42rem)] w-[min(26rem,calc(100vw-3rem))] -translate-y-1/2 overflow-hidden rounded-3xl border border-border bg-(--surface-strong) shadow-[0_24px_90px_rgba(0,0,0,0.45)] sm:right-5 sm:w-[min(28rem,calc(100vw-3rem))]">
            {isAuthenticated && user ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center p-8 text-sm text-text-muted">Loading notifications...</div>}>
                <NotificationsPage embedded onClose={() => setIsNotificationsOpen(false)} />
              </Suspense>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><BellRing className="h-7 w-7" /></span>
                <h2 className="mt-4 text-lg font-semibold text-text-primary">Sign in to view notifications</h2>
                <p className="mt-2 max-w-xs text-sm leading-6 text-text-muted">Create an account or sign in to receive match, highlight, and account updates.</p>
                <Button asChild className="mt-5 rounded-full px-5" onClick={() => setIsNotificationsOpen(false)}><Link to="/login">Sign in</Link></Button>
              </div>
            )}
          </aside>
        </>
      )}
    </header>
  )
}

