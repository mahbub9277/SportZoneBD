import { Suspense, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { GlobalLoadingIndicator } from '../../components/shared/GlobalLoadingIndicator'
import { useSessionHeartbeat } from '../moderation/useSessionHeartbeat'
import { cn } from '../../lib/utils'
import { ConsoleBaseContext } from './consoleBase'
import { ConsoleHeader } from './components/ConsoleHeader'
import { ConsoleSidebar } from './components/ConsoleSidebar'
import type { ConsoleNavSection } from './config/consoleNav.config'

interface ConsoleLayoutProps {
  /** Console prefix, e.g. `/moderator`. */
  base: string
  /** The console's own sign-in route, used when the session ends. */
  loginPath: string
  brandSubtitle: string
  sections: ConsoleNavSection[]
}

/**
 * The shared shell for the moderator and staff consoles.
 *
 * It mirrors the admin layout so the experience stays consistent, but it lives under its own route
 * prefix: a moderator never renders an admin layout, and the navigation it shows is already filtered
 * down to the permissions the backend resolved for the user.
 */
export function ConsoleLayout({ base, loginPath, brandSubtitle, sections }: ConsoleLayoutProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

  // A staff member working in a console is active by definition: this is what lets the activity view tell
  // an open console apart from an abandoned tab. It writes one session timestamp every few minutes and
  // never extends the session itself.
  useSessionHeartbeat()

  return (
    <ConsoleBaseContext.Provider value={base}>
      <div className="min-h-screen bg-brand-background text-brand-text-primary">
        <ConsoleSidebar sections={sections} loginPath={loginPath} brandSubtitle={brandSubtitle} />

        <div
          className={cn(
            'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden',
            isMobileSidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => setIsMobileSidebarOpen(false)}
        />
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-[min(24rem,calc(100vw-1rem))] transform transition-transform duration-300 lg:hidden [&>aside]:flex [&>aside]:h-full [&>aside]:w-full',
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <ConsoleSidebar
            sections={sections}
            loginPath={loginPath}
            brandSubtitle={brandSubtitle}
            isMobile
            onNavigate={() => setIsMobileSidebarOpen(false)}
          />
        </div>

        <div className="flex min-h-screen flex-col lg:ml-80">
          <ConsoleHeader base={base} loginPath={loginPath} onMobileMenuClick={() => setIsMobileSidebarOpen(true)} />
          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <Suspense fallback={<GlobalLoadingIndicator force />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </ConsoleBaseContext.Provider>
  )
}
