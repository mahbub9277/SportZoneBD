/* eslint-disable react-refresh/only-export-components */
import { Outlet, useLocation } from 'react-router-dom'
import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Toaster } from 'sonner'
import { Breadcrumb } from '../../../components/ui/Breadcrumb'
import { Header } from '../../../shared/ui/Header'
import { Footer } from '../../../shared/ui/Footer'
import { Sidebar } from '../../../components/shared/Sidebar'
import { GlobalLoadingIndicator } from '../../../components/shared/GlobalLoadingIndicator'
import { MobileBottomNav } from '../../../components/shared/MobileBottomNav'
import { SocketProvider } from '../../useSocket'
import { MiniPlayer, type MiniPlayerSource } from '../../../components/player/mini-player/MiniPlayer'
import { AdvertisementGateProvider } from '../../useAdvertisementGate'

interface MiniPlayerContextValue {
  activePlayer: MiniPlayerSource | null
  setActivePlayer: (player: MiniPlayerSource | null) => void
}

const MiniPlayerContext = createContext<MiniPlayerContextValue | null>(null)

export function useMiniPlayer() {
  const context = useContext(MiniPlayerContext)
  if (!context) throw new Error('useMiniPlayer must be used within UserLayout')
  return context
}

function MiniPlayerProvider({ children }: { children: React.ReactNode }) {
  const [activePlayer, setActivePlayerState] = useState<MiniPlayerSource | null>(null)

  const setActivePlayer = useCallback((player: MiniPlayerSource | null) => setActivePlayerState(player), [])

  const value = useMemo(
    () => ({ activePlayer, setActivePlayer }),
    [activePlayer, setActivePlayer],
  )

  return <MiniPlayerContext.Provider value={value}>{children}</MiniPlayerContext.Provider>
}

function MiniPlayerHost() {
  const { activePlayer, setActivePlayer } = useMiniPlayer()
  return <MiniPlayer activePlayer={activePlayer} setActivePlayer={setActivePlayer} />
}

const USER_PREVIOUS_ROUTE_KEY = 'sportzone:user-previous-route'

const UserLayout = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const shouldReduceMotion = useReducedMotion()
  const previousRouteRef = useRef<string | null>(null)

  useEffect(() => {
    const currentRoute = `${location.pathname}${location.search}`
    const previousRoute = previousRouteRef.current

    previousRouteRef.current = currentRoute

    if (!currentRoute.startsWith('/')) {
      return
    }

    if (currentRoute.startsWith('/admin') || currentRoute.startsWith('/login') || currentRoute.startsWith('/verify-email') || currentRoute.startsWith('/forgot-password') || currentRoute.startsWith('/reset-password') || currentRoute === '/unauthorized') {
      return
    }

    if (previousRoute && previousRoute !== currentRoute && previousRoute.startsWith('/')) {
      window.sessionStorage.setItem(USER_PREVIOUS_ROUTE_KEY, previousRoute)
    }
  }, [location.pathname, location.search])

  return (
    <SocketProvider>
      <MiniPlayerProvider>
      <AdvertisementGateProvider>
      <div className="min-h-screen bg-(--background) text-(--text-primary)">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-[1600px] flex-col gap-5 px-3 py-4 sm:gap-6 sm:px-6 sm:py-6 lg:px-8 xl:flex-row xl:gap-8">
          <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="min-w-0 flex-1 pb-28 xl:pb-0">
            <Breadcrumb />
            <Toaster richColors position="top-right" closeButton />
            <MiniPlayerHost />
            <Suspense fallback={<GlobalLoadingIndicator force />}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -6 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="min-w-0"
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </Suspense>
          </main>
        </div>
        <Footer />
        <MobileBottomNav />
      </div>
      </AdvertisementGateProvider>
      </MiniPlayerProvider>
    </SocketProvider>
  )
}

export default UserLayout