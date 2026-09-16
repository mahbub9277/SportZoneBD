import { NavLink, Outlet } from 'react-router-dom'
import { User, Palette, Bell, CreditCard } from 'lucide-react'
import { cn } from '../../../lib/utils'

const navLinks = [
  { href: '/profile/settings', label: 'Profile', icon: User },
  { href: '/profile/settings/appearance', label: 'Appearance', icon: Palette },
  { href: '/profile/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/profile/settings/billing', label: 'Billing', icon: CreditCard },
]

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-brand-text-secondary transition-all hover:bg-brand-surface-soft hover:text-brand-text-primary',
    isActive && 'bg-brand-surface-strong text-brand-text-primary',
  )

export function SettingsLayout() {
  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-6 md:grid-cols-[180px_1fr] lg:grid-cols-[250px_1fr]">
      <nav className="grid gap-4 text-sm text-brand-text-muted">
        {navLinks.map((link) => (
          <NavLink
            key={link.href}
            to={link.href}
            end={link.href === '/profile/settings'} // `end` prop for the base route
            className={navLinkClasses}
          >
            <link.icon className="h-4 w-4" />
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="grid gap-6">
        <Outlet />
      </div>
    </div>
  )
}