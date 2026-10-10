import { useState, type MouseEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut } from 'lucide-react'
import { cva } from 'class-variance-authority'

import { useTheme } from '../../../hooks/useTheme'
import { cn } from '../../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../../app/hooks'
import { logout, selectCurrentUser } from '../../auth/authSlice'
import { useLogoutMutation } from '../../auth/auth.api'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/Avatar'
import { Button } from '../../../components/ui/Button'
import { DynamicIcon } from '../../../components/DynamicIcon'
import type { ConsoleNavLink, ConsoleNavSection } from '../config/consoleNav.config'
import localLogo from '../../../assets/logo.png.webp'

interface ConsoleSidebarProps {
  sections: ConsoleNavSection[]
  /** Where signing out returns the user: the console's own sign-in route. */
  loginPath: string
  /** Short label under the product name, e.g. "Moderator Console". */
  brandSubtitle: string
  isMobile?: boolean
  onNavigate?: () => void
}

export function ConsoleSidebar({ sections, loginPath, brandSubtitle, isMobile = false, onNavigate }: ConsoleSidebarProps) {
  const { theme } = useTheme()
  const user = useAppSelector(selectCurrentUser)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const [logoutRequest] = useLogoutMutation()

  const handleLogout = async () => {
    try {
      // Invalidating the server session is what actually ends the refresh-session chain.
      await logoutRequest().unwrap()
    } catch {
      // A failed server call must not leave the interface thinking the user is still signed in.
      dispatch(logout())
    }
    navigate(loginPath, { replace: true })
  }

  const isActiveLink = (href: string, end = false) => {
    if (end) {
      return location.pathname === href
    }
    return location.pathname === href || location.pathname.startsWith(`${href}/`)
  }

  const navLinkVariants = cva(
    'flex items-center justify-between gap-3 rounded-3xl border border-transparent px-4 py-3 text-text-muted transition duration-200 ease-in-out hover:border-border hover:bg-surface-soft hover:text-text-primary hover:shadow-sidebar-nav-hover',
    {
      variants: {
        active: {
          true: 'border-accent/30 bg-accent/10 text-accent shadow-sidebar-nav-active',
        },
      },
    },
  )

  const SidebarNavLink = ({ link }: { link: ConsoleNavLink }) => {
    const [isOpen, setIsOpen] = useState(isActiveLink(link.href, link.end))
    const hasSubLinks = Boolean(link.subLinks && link.subLinks.length > 0)
    const active = isActiveLink(link.href, link.end)

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (hasSubLinks) {
        event.preventDefault()
        setIsOpen((previous) => !previous)
        return
      }
      onNavigate?.()
    }

    return (
      <>
        <NavLink to={link.href} end={link.end} onClick={handleClick} className={cn(navLinkVariants({ active }))}>
          <div className="flex items-center gap-3">
            <DynamicIcon name={link.icon} className="h-5 w-5 shrink-0" />
            <span className="truncate">{isMobile ? link.mobileLabel ?? link.label : link.label}</span>
          </div>
          {hasSubLinks && <ChevronDown className={cn('h-4 w-4 transition-transform', (isOpen || active) && 'rotate-180')} />}
        </NavLink>
        {hasSubLinks && (isOpen || active) && (
          <div className="ml-4 flex flex-col gap-1 pl-4">
            {link.subLinks?.map((subLink) => <SidebarNavLink key={subLink.href} link={subLink} />)}
          </div>
        )}
      </>
    )
  }

  return (
    <aside
      className={cn(
        theme === 'light' ? 'admin-sidebar-bg-light' : 'admin-sidebar-bg-dark',
        'flex min-h-0 flex-col justify-between p-3 text-text-primary shadow-premium sm:p-5',
        isMobile ? 'h-full w-full lg:hidden' : 'fixed inset-y-0 left-0 z-30 hidden h-screen w-80 lg:flex',
      )}
      aria-label={`${brandSubtitle} navigation`}
    >
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex items-center justify-between rounded-panel border border-border bg-surface-soft p-2 shadow-sidebar-panel">
          <div className="flex items-center gap-3">
            <img src={localLogo} alt="SportZoneBD logo" className="h-9 w-auto max-w-36 rounded-xl object-contain" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-text-primary">SportZoneBD</h1>
              <p className="text-xs uppercase tracking-[0.32em] text-accent/80">{brandSubtitle}</p>
            </div>
          </div>
        </div>

        <nav className="mt-8 flex flex-col gap-4">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.3em] text-text-muted">{section.title}</p>
              <div className="flex flex-col gap-1">
                {section.links.map((link) => <SidebarNavLink key={link.href} link={link} />)}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {!isMobile && (
        <div className="mt-6 rounded-panel border border-border bg-surface-soft p-4 text-sm text-text-muted shadow-sidebar-panel-glow">
          <p className="font-semibold text-text-primary">Scoped access</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            You can only reach the modules your account has been granted.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 pt-5">
        <div className="flex w-full items-center gap-3 px-2">
          <Avatar className="h-11 w-11 border border-accent/30 bg-surface-soft shadow-admin-avatar">
            <AvatarImage src={user?.avatar ?? undefined} alt={user?.fullName || 'User'} />
            <AvatarFallback name={user?.fullName || user?.email || ''} />
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-text-primary">{user?.fullName}</p>
            <p className="truncate text-xs text-text-muted">{user?.email}</p>
          </div>
        </div>

        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-(--danger) hover:bg-(--danger-soft) hover:text-(--danger)"
          onClick={handleLogout}
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </Button>
      </div>
    </aside>
  )
}
