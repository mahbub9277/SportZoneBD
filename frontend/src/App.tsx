import { useEffect, useMemo, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { router } from '@/routes'
import { SplashScreen } from '@/components/ui/SplashScreen'
import { Toaster } from 'sonner'
import { useGetAdminSettingsQuery } from './features/admin/admin.api'
import { useInitialLoad } from './hooks/useInitialLoad'
import { useAppSelector } from './app/hooks'
import { selectIsAdmin } from './features/auth/auth.slice'
import { Button } from './components/ui/Button'
import { PwaExperienceContext, type PwaUpdateStatus } from './features/pwa/PwaExperienceContext'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaUpdateDetail {
  waiting?: ServiceWorker | null
}

const INSTALL_DISMISSED_KEY = 'sportzone-pwa-install-dismissed'
const UPDATE_DISMISSED_KEY = 'sportzone-pwa-update-dismissed'

function readSessionFlag(key: string): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeSessionFlag(key: string, enabled: boolean): void {
  try {
    if (enabled) window.sessionStorage.setItem(key, 'true')
    else window.sessionStorage.removeItem(key)
  } catch {
    // Dismissal persistence is optional when browser storage is unavailable.
  }
}

export function App() {
  const { isLoading } = useInitialLoad()
  const isAdmin = useAppSelector(selectIsAdmin)
  const { data: settings = [] } = useGetAdminSettingsQuery(undefined, { skip: !isAdmin })
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [isUpdateDismissed, setIsUpdateDismissed] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus>('idle')
  const [isUpdating, setIsUpdating] = useState(false)

  const isInstalled = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  )

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    const handleInstallable = (event: Event) => {
      const wasDismissed = readSessionFlag(INSTALL_DISMISSED_KEY)
      if (isInstalled || wasDismissed) return
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setInstallPrompt(null)
      writeSessionFlag(INSTALL_DISMISSED_KEY, false)
    }
    const handleUpdateAvailable = (event: Event) => {
      const registration = (event as CustomEvent<PwaUpdateDetail>).detail
      if (registration) {
        setUpdateRegistration(registration as ServiceWorkerRegistration)
        const wasDismissed = readSessionFlag(UPDATE_DISMISSED_KEY)
        setIsUpdateDismissed(wasDismissed)
        setUpdateStatus(wasDismissed ? 'idle' : 'available')
      }
    }
    const handleServiceWorkerMessage = (event: MessageEvent<{ type?: string; url?: string }>) => {
      if (event.data?.type !== 'OPEN_NOTIFICATION' || !event.data.url?.startsWith('/') || event.data.url.startsWith('//')) return
      void router.navigate(event.data.url)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeinstallprompt', handleInstallable)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('sportzonebd:pwa-update-available', handleUpdateAvailable)
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeinstallprompt', handleInstallable)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('sportzonebd:pwa-update-available', handleUpdateAvailable)
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage)
    }
  }, [isInstalled])

  const handleInstall = async () => {
    if (!installPrompt) return
    try {
      await installPrompt.prompt()
      const result = await installPrompt.userChoice
      if (result.outcome === 'accepted') setInstallPrompt(null)
    } catch {
      setInstallPrompt(null)
    }
  }

  const checkForUpdates = async () => {
    if (!('serviceWorker' in navigator) || !navigator.onLine) {
      setUpdateStatus('error')
      return
    }

    setUpdateStatus('checking')
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      if (!registration) {
        setUpdateStatus('error')
        return
      }
      await registration.update()
      const installingWorker = registration.installing
      let installState: ServiceWorkerState | null = null
      if (installingWorker) {
        installState = await new Promise<ServiceWorkerState>((resolve) => {
          const handleStateChange = () => {
            if (installingWorker.state === 'installed' || installingWorker.state === 'activated' || installingWorker.state === 'redundant') {
              installingWorker.removeEventListener('statechange', handleStateChange)
              resolve(installingWorker.state)
            }
          }
          installingWorker.addEventListener('statechange', handleStateChange)
          handleStateChange()
        })
      }
      if (registration.waiting) {
        setUpdateRegistration(registration)
        setIsUpdateDismissed(false)
        writeSessionFlag(UPDATE_DISMISSED_KEY, false)
        setUpdateStatus('available')
      } else if (installState === 'redundant') {
        setUpdateStatus('error')
      } else {
        setUpdateStatus('up-to-date')
      }
    } catch {
      setUpdateStatus('error')
    }
  }

  const applyUpdate = () => {
    const waitingWorker = updateRegistration?.waiting
    if (!waitingWorker) return
    setUpdateStatus('updating')
    setIsUpdating(true)
    const reload = () => {
      writeSessionFlag(UPDATE_DISMISSED_KEY, false)
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  }

  const dismissUpdate = () => {
    setIsUpdateDismissed(true)
    writeSessionFlag(UPDATE_DISMISSED_KEY, true)
    setUpdateStatus('idle')
  }

  const pwaExperience = {
    isOffline,
    isInstalled,
    canInstall: Boolean(installPrompt) && !isInstalled,
    updateStatus,
    installApp: handleInstall,
    checkForUpdates,
    applyUpdate,
    dismissUpdate,
  }

  const siteBrand = useMemo(() => {
    const settingsMap = new Map(settings.map(s => [s.key, s.value]))
    const savedVariant = settingsMap.get('site.splash_variant')
    const variant: 'standard' | 'premium' = savedVariant === 'premium' ? 'premium' : 'standard'

    return {
      splashLogo: settingsMap.get('site.splash_logo_url'),
      name: settingsMap.get('site.title') || 'SportZoneBD',
      tagline: settingsMap.get('site.tagline') || 'Live sports, instant access',
      variant,
    }
  }, [settings])

  return (
    <PwaExperienceContext.Provider value={pwaExperience}>
      {(isOffline || (installPrompt && !isInstalled) || (updateRegistration && !isUpdateDismissed) || isUpdating) && (
        <div className="fixed inset-x-3 bottom-4 z-9998 mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-border bg-(--surface-strong) p-4 text-sm text-text-primary shadow-[0_20px_70px_rgba(0,0,0,0.35)] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">{isUpdating ? 'Updating SportZoneBD...' : updateRegistration && !isUpdateDismissed ? 'New version available' : isOffline ? 'You are offline.' : 'Install SportZoneBD'}</p>
            <p className="mt-1 text-xs text-text-muted">{isUpdating ? 'Please wait while the app reloads.' : updateRegistration && !isUpdateDismissed ? 'A new app version is ready to install.' : isOffline ? 'Cached app resources remain available. Live data needs a connection.' : 'Get a faster, app-like experience.'}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {isUpdating ? <span role="status" aria-live="polite" className="sr-only">Updating SportZoneBD. Please wait.</span> : updateRegistration && !isUpdateDismissed ? <><Button type="button" size="sm" onClick={applyUpdate}>Update now</Button><Button type="button" variant="ghost" size="sm" onClick={dismissUpdate}>Later</Button></> : installPrompt && !isInstalled ? <><Button type="button" size="sm" onClick={() => void handleInstall}>Install App</Button><Button type="button" variant="ghost" size="sm" onClick={() => { writeSessionFlag(INSTALL_DISMISSED_KEY, true); setInstallPrompt(null) }}>Later</Button></> : null}
          </div>
        </div>
      )}
      <AnimatePresence>
        <SplashScreen
          isDataLoading={isLoading}
          splashLogo={siteBrand.splashLogo} // siteFavicon is not a prop of SplashScreen
          channelName={siteBrand.name}
          channelTagline={siteBrand.tagline}
          variant={siteBrand.variant}
        />
      </AnimatePresence>

      <RouterProvider router={router} />
      <Toaster position="bottom-right" richColors />
    </PwaExperienceContext.Provider>
  )
}