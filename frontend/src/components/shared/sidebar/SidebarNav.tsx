import { NavLink } from 'react-router-dom'
import { Home, Swords, Radio, PlayCircle, BarChart3, User, LogOut, Sparkles, AlertTriangle, Heart, LayoutGrid, Info, type LucideIcon } from 'lucide-react'
import { cva } from 'class-variance-authority'
import { cn } from '../../../lib/utils'
import { useGetSidebarEventsQuery } from '../../../features/events/events.api'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'

const navLinkVariants = cva(
  'relative flex items-center gap-2.5 rounded-xl px-2.75 py-2.5 text-[13px] font-semibold leading-none text-text-muted transition duration-200 ease-in-out hover:bg-surface-soft hover:text-text-primary',
  { variants: { active: { true: 'border border-accent/25 bg-accent/10 text-text-primary shadow-nav-active' } } },
)

interface SidebarNavProps { isAuthenticated: boolean; onLogout: () => void; onNavigate?: () => void }
interface NavItemProps { href: string; label: string; icon: LucideIcon; isLast?: boolean; end?: boolean; onClick?: () => void }

const NavItem = ({ href, label, icon: Icon, isLast, end, onClick }: NavItemProps) => (
  <NavLink to={href} className={({ isActive }) => cn(navLinkVariants({ active: isActive }))} end={end} onClick={onClick}>
    {({ isActive }) => <><div className={cn('nav-connector-main', isActive && 'nav-connector-main-active', isLast && 'nav-connector-main-last')} aria-hidden="true" /><Icon className="relative z-10 h-6 w-6 shrink-0" /><span className="relative z-10 truncate">{label}</span></>}
  </NavLink>
)

export function SidebarNav({ isAuthenticated, onLogout, onNavigate }: SidebarNavProps) {
  const { data: sidebarEvents } = useGetSidebarEventsQuery()
  const events = sidebarEvents ?? []
  return (
    <nav className="mt-4 grid items-start gap-1.5 text-sm font-medium">
      <h3 className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-text-muted sm:text-[11px]">Main</h3>
      <NavItem href="/" label="Home" icon={Home} end onClick={onNavigate} />
      <NavItem href="/matches" label="All Matches" icon={Swords} onClick={onNavigate} />
      <NavItem href="/channels" label="TV Channels" icon={Radio} onClick={onNavigate} />
      <NavItem href="/categories" label="Categories" icon={LayoutGrid} onClick={onNavigate} />
      <NavItem href="/favorites" label="Favorites" icon={Heart} onClick={onNavigate} />
      <h3 className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-text-muted sm:text-[11px]">Explore</h3>
      <NavItem href="/highlights" label="Highlights" icon={PlayCircle} onClick={onNavigate} />
      <NavItem href="/standings" label="Standings" icon={BarChart3} onClick={onNavigate} />
      <NavItem href="/reports" label="Report Problem" icon={AlertTriangle} onClick={onNavigate} />
      <NavItem href="/subscriptions" label="Premium Access" icon={Sparkles} onClick={onNavigate} isLast={!isAuthenticated} />
      {events.length > 0 && <><h3 className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-text-muted sm:text-[11px]">Events</h3>{events.map((event) => <NavLink key={event.id} to={`/events/${event.slug}`} onClick={onNavigate} className={({ isActive }) => cn(navLinkVariants({ active: isActive }))}><span className="nav-connector-main" aria-hidden="true" />{event.logo ? <img src={buildCloudinaryUrl(event.logo, { width: 28, height: 28, crop: 'fill' })} alt="" className="relative z-10 h-6 w-6 shrink-0 rounded-lg object-contain" /> : <Sparkles className="relative z-10 h-6 w-6 shrink-0 text-accent" />}<span className="relative z-10 truncate">{event.name}</span></NavLink>)}</>}
      {isAuthenticated && <><h3 className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-text-muted sm:text-[11px]">My Account</h3><NavItem href="/profile" label="My Profile" icon={User} onClick={onNavigate} /></>}
      <div className="mt-2 pt-2">
        <NavItem href="/about" label="About" icon={Info} onClick={onNavigate} isLast />
      </div>
      {isAuthenticated && <button onClick={() => { onNavigate?.(); onLogout() }} className="relative mt-1 flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.75 py-2.5 text-left text-[13px] font-semibold text-text-muted transition duration-200 ease-in-out hover:border-border hover:bg-surface-soft hover:text-text-primary hover:shadow-nav-active"><div className="nav-connector-main nav-connector-main-last" aria-hidden="true" /><LogOut className="relative z-10 h-6 w-6 shrink-0" /><span className="relative z-10 truncate">Logout</span></button>}
    </nav>
  )
}
