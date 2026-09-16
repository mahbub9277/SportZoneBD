import { NavLink, useLocation } from 'react-router-dom'
import { Crown, Home, LayoutGrid, Radio, Swords } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

interface MobileNavItem {
  label: string
  href: string
  icon: LucideIcon
  end?: boolean
}

const navItems: MobileNavItem[] = [
  { label: 'Home', href: '/', icon: Home, end: true },
  { label: 'Matches', href: '/matches', icon: Swords },
  { label: 'Channels', href: '/channels', icon: Radio },
  { label: 'Categories', href: '/categories', icon: LayoutGrid },
  { label: 'Premium', href: '/subscriptions', icon: Crown },
]

export function MobileBottomNav() {
  const location = useLocation()

  const isActive = (item: MobileNavItem) => item.end
    ? location.pathname === item.href
    : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`)

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-5 left-4 right-4 z-50 sm:hidden"
      style={{ bottom: 'max(1.25rem, calc(1.25rem + env(safe-area-inset-bottom)))' }}
    >
      <div className="mx-auto flex w-full max-w-lg items-center justify-around gap-1 rounded-full border border-white/15 bg-slate-900/60 px-3 py-3 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item)
          return (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.end}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              className={cn(
                'flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full px-1 text-[10px] font-semibold whitespace-nowrap transition-all duration-300 ease-out active:scale-95',
                active ? 'scale-105 bg-white/10 text-accent shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]' : 'text-gray-400 hover:text-white',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              <span className="max-w-full truncate px-0.5 leading-none">{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
