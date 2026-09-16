import { Menu, Bell, User as UserIcon, Settings, LogOut, ExternalLink } from 'lucide-react'
import { useAppSelector, useAppDispatch } from '../../app/hooks'
import { selectCurrentUser, logout } from '../auth/authSlice'
import { Button } from '../../components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/AdminDropdownMenu'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildCloudinaryUrl } from '../../utils/cloudinary'

// Function to generate breadcrumbs from the path
const generateBreadcrumbs = (pathname: string) => {
  const pathParts = pathname.split('/').filter(part => part);
  if (pathParts.length === 0 || pathParts[0] !== 'admin') {
    return [{ label: 'Dashboard', path: '/admin' }];
  }

  const breadcrumbs = pathParts.map((part, index) => {
    const path = `/${pathParts.slice(0, index + 1).join('/')}`;
    const label = part.charAt(0).toUpperCase() + part.slice(1).replace('-', ' ');
    return { label, path };
  });

  return breadcrumbs;
};

export function AdminHeader({ onMobileMenuClick }: { onMobileMenuClick: () => void }) {
  const user = useAppSelector(selectCurrentUser);
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation();
  const breadcrumbs = generateBreadcrumbs(location.pathname);

  const handleLogout = () => {
    dispatch(logout())
    navigate('/admin/login', { replace: true })
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
          <nav className="flex items-center space-x-2 whitespace-nowrap text-sm font-medium text-(--text-secondary)">
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
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="h-11 w-11 border border-(--border) bg-(--surface-soft) text-(--text-primary) hover:bg-(--surface) focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface)"
          onClick={() => navigate('/admin/push-notifications')}
        >
          <Bell className="h-5 w-5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex h-11 items-center rounded-full border border-(--border) bg-(--surface-soft) p-1 transition hover:bg-(--surface) focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface)"
            >
              <img
                src={buildCloudinaryUrl(user?.avatar, { width: 32, height: 32, crop: 'fill', gravity: 'face' })}
                alt="User Avatar"
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
            <DropdownMenuItem onSelect={() => navigate('/admin/profile')}>
              <UserIcon className="mr-2 h-4 w-4 text-slate-300" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('/admin/settings')}>
              <Settings className="mr-2 h-4 w-4 text-slate-300" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={handleLogout}
              className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
            >
              <LogOut className="mr-2 h-4 w-4 text-red-400" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
