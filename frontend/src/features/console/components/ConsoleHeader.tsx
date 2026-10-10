import { Menu, User as UserIcon, LogOut, ExternalLink } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAppDispatch, useAppSelector } from '../../../app/hooks'
import { logout, selectCurrentUser } from '../../auth/authSlice'
import { useLogoutMutation } from '../../auth/auth.api'
import { Button } from '../../../components/ui/Button'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../admin/components/AdminDropdownMenu'

interface ConsoleHeaderProps {
  /** Console prefix, e.g. `/moderator`. Used for the breadcrumb trail. */
  base: string
  onMobileMenuClick: () => void
  /** Where signing out returns the user. */
  loginPath: string
}

const generateBreadcrumbs = (pathname: string, base: string) => {
  const segment = base.replace(/^\//, '')
  const parts = pathname.split('/').filter(Boolean)

  if (parts[0] !== segment) {
    return [{ label: 'Dashboard', path: base }]
  }

  return parts.map((part, index) => ({
    label: part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '),
    path: `/${parts.slice(0, index + 1).join('/')}`,
  }))
}

export function ConsoleHeader({ base, onMobileMenuClick, loginPath }: ConsoleHeaderProps) {
  const user = useAppSelector(selectCurrentUser)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const breadcrumbs = generateBreadcrumbs(location.pathname, base)
  const [logoutRequest] = useLogoutMutation()

  const handleLogout = async () => {
    try {
      await logoutRequest().unwrap()
    } catch {
      dispatch(logout())
    }
    navigate(loginPath, { replace: true })
  }

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-(--border) bg-(--surface)/95 px-3 shadow-[0_18px_60px_var(--shadow)] backdrop-blur-xl transition-colors duration-300 ease-in-out sm:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-3 top-3 z-60 border border-(--border) bg-(--surface-soft) text-(--text-primary) shadow-lg hover:bg-(--surface) lg:hidden"
          aria-label="Open menu"
          onClick={onMobileMenuClick}
        >
          <Menu className="h-6 w-6" />
        </Button>
        <div className="hidden max-w-[min(70vw,34rem)] overflow-x-auto rounded-full border border-(--border) bg-(--surface-soft) px-4 py-2 text-sm text-(--text-secondary) shadow-sm lg:flex">
          <nav className="flex items-center space-x-2 whitespace-nowrap text-sm font-medium text-(--text-secondary)" aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.path} className="flex items-center gap-2">
                <span className={index === breadcrumbs.length - 1 ? 'text-(--text-primary)' : 'text-(--text-muted)'}>{crumb.label}</span>
                {index < breadcrumbs.length - 1 && <span className="text-(--text-muted)">/</span>}
              </span>
            ))}
          </nav>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              aria-label="Account menu"
              className="flex h-11 items-center rounded-full border border-(--border) bg-(--surface-soft) p-1 transition hover:bg-(--surface) focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface)"
            >
              <img
                src={buildCloudinaryUrl(user?.avatar, { width: 32, height: 32, crop: 'fill', gravity: 'face' })}
                alt=""
                className="h-8 w-8 rounded-full border border-(--border) object-cover"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[min(16rem,calc(100vw-1rem))] rounded-3xl border border-(--border) bg-(--surface)/95 p-2 shadow-[0_30px_80px_var(--shadow)] backdrop-blur-xl"
          >
            <DropdownMenuLabel>
              <p className="font-semibold text-(--text-primary)">{user?.fullName}</p>
              <p className="break-all text-xs font-normal text-(--text-muted)">{user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => window.open('/', '_blank', 'noopener,noreferrer')}>
              <ExternalLink className="mr-2 h-4 w-4 text-slate-300" />
              <span>View website</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(`${base}/profile`)}>
              <UserIcon className="mr-2 h-4 w-4 text-slate-300" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout} className="text-red-400 focus:bg-red-500/10 focus:text-red-400">
              <LogOut className="mr-2 h-4 w-4 text-red-400" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
