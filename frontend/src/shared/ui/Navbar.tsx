import { NavLink, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, Clapperboard, LogIn, ShieldCheck, MoonStar, SunMedium } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { cva } from 'class-variance-authority'
import { appRoutes } from '../lib/routes'
import { useTheme } from '../../hooks/useTheme'
import { useAppDispatch } from '../../app/hooks'
import { useAuth } from '../../hooks/common/layouts/useAuth'
import { logout } from '../../features/auth/auth.slice'

export function Navbar() {
  const { theme, toggleTheme } = useTheme()
  const dispatch = useAppDispatch()
  const { isAuthenticated, isAdmin } = useAuth()

  const navLinkVariants = cva(
    'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-text-muted transition-all hover:bg-surface hover:text-text-primary',
    {
      variants: {
        active: { true: 'bg-accent text-black shadow-glow' },
      },
    },
  )

  const navLinks = [
    { label: 'Home', href: appRoutes.home, icon: Home },
    { label: 'Matches', href: appRoutes.matches, icon: Clapperboard },
  ]

  if (isAdmin) {
    navLinks.push({ label: 'Admin', href: appRoutes.admin, icon: ShieldCheck })
  }

  const handleLogout = () => {
    dispatch(logout())
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-surface/80 shadow-2xl shadow-background/50 backdrop-blur-xl">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <Link to={appRoutes.home} className="flex items-center gap-2.5 rounded-full border border-border/70 bg-surface-soft/70 px-2.5 py-1.5 shadow-[0_10px_30px_rgba(2,6,23,0.12)] transition hover:border-accent/40 hover:shadow-glow">
          <div className="rounded-xl border border-accent/25 bg-[linear-gradient(135deg,rgba(255,210,79,0.2),rgba(83,183,255,0.15))] p-2 text-accent shadow-glow">
            <ShieldCheck size={20} />
          </div>
          <div className="leading-none">
            <p className="font-semibold tracking-tight text-text-primary">SportZoneBD</p>
            <p className="text-xs text-text-muted">Production football platform</p>
          </div>
        </Link>
        </motion.div>

        <motion.nav initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }} className="hidden items-center gap-1 rounded-full border border-border/70 bg-surface-soft/75 p-1 shadow-inner md:flex">
          {navLinks.map((link) => {
            const Icon = link.icon
            return (
              <NavLink key={link.href} to={link.href} className={({ isActive }) => navLinkVariants({ active: isActive })}>
                <Icon size={16} />
                {link.label}
              </NavLink>
            )
          })}
        </motion.nav>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex size-9 items-center justify-center rounded-full border border-border bg-surface-soft/80 text-text-primary shadow-md transition hover:border-accent/40 hover:text-accent"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <SunMedium size={18} /> : <MoonStar size={18} />}
          </button>

          {isAuthenticated ? (
            <>
              <Link
                to={appRoutes.profile}
                className="hidden rounded-full border border-border bg-surface-soft/80 px-3 py-1.5 text-sm text-text-primary shadow-md transition hover:border-accent/40 md:inline-flex"
              >
                Profile
              </Link>
              <Button variant="outline" size="sm" onClick={handleLogout} className="hidden md:inline-flex">
                Sign out
              </Button>
            </>
          ) : (
            <Link
              to={appRoutes.auth}
              className="hidden rounded-full border border-border bg-surface-soft/80 px-3 py-1.5 text-sm text-text-primary shadow-md transition hover:border-accent/40 md:inline-flex"
            >
              <span className="flex items-center gap-2"><LogIn size={16} /> Sign in</span>
            </Link>
          )}
        </motion.div>
      </motion.div>
    </header>
  )
}
