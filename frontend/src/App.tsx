import { useEffect, useMemo, useRef, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Download, X } from 'lucide-react'
import { router } from '@/routes'
import { SplashScreen } from '@/components/ui/SplashScreen'
import { toast, Toaster } from 'sonner'
import { useGetAdminSettingsQuery } from './features/admin/admin.api'
import { useInitialLoad } from './hooks/useInitialLoad'
import { useAppSelector } from './app/hooks'
import { selectIsAdmin } from './features/auth/auth.slice'
import { Button } from './components/ui/Button'
import { PwaExperienceContext, type PwaUpdateStatus } from './features/pwa/PwaExperienceContext'
import { INSTALL_PROMPT_DELAY_MS, installPromptDelayRemainingMs } from './features/pwa/installPromptDelay'

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

  // A `beforeinstallprompt` event is captured whenever the browser offers it, even before the minimum
  // delay has passed, so a prompt that arrives early is not lost.
  const deferredInstallEventRef = useRef<BeforeInstallPromptEvent | null>(null)
  const isInstallPromptEligibleRef = useRef(false)
  const isInstalledRef = useRef(isInstalled)
  useEffect(() => {
    isInstalledRef.current = isInstalled
  })

  useEffect(() => {
    // A first-visit install banner is useful, but only once the visitor has settled: the prompt waits
    // for a minimum amount of real elapsed time, and a `beforeinstallprompt` event that arrives earlier
    // is stored and offered later instead of being lost.
    const startedAtMs = Date.now()
    let timer = 0
    const offerInstallPrompt = () => {
      const remainingMs = installPromptDelayRemainingMs(startedAtMs, Date.now())
      if (remainingMs > 0) {
        timer = window.setTimeout(offerInstallPrompt, remainingMs)
        return
      }
      timer = 0
      isInstallPromptEligibleRef.current = true
      const deferred = deferredInstallEventRef.current
      if (deferred && !isInstalledRef.current && !readSessionFlag(INSTALL_DISMISSED_KEY)) setInstallPrompt(deferred)
    }
    timer = window.setTimeout(offerInstallPrompt, INSTALL_PROMPT_DELAY_MS)
    return () => {
      if (timer !== 0) window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    const handleInstallable = (event: Event) => {
      event.preventDefault()
      const deferred = event as BeforeInstallPromptEvent
      deferredInstallEventRef.current = deferred
      // Before the delay has elapsed the event is only stored; the delay effect offers it later.
      if (!isInstallPromptEligibleRef.current) return
      if (isInstalled || readSessionFlag(INSTALL_DISMISSED_KEY)) return
      setInstallPrompt(deferred)
    }
    const handleInstalled = () => {
      deferredInstallEventRef.current = null
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
    const pendingPrompt = installPrompt
    if (!pendingPrompt) return
    setInstallPrompt(null)
    try {
      await pendingPrompt.prompt()
      const result = await pendingPrompt.userChoice
      if (result.outcome === 'dismissed') writeSessionFlag(INSTALL_DISMISSED_KEY, true)
    } catch {
      writeSessionFlag(INSTALL_DISMISSED_KEY, true)
      toast.error('The install prompt could not be opened. Use the browser menu if it offers an Install App option.')
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
        <div role="region" aria-label={installPrompt && !isInstalled ? 'Install SportZoneBD' : 'SportZoneBD app status'} className="fixed inset-x-3 bottom-4 z-9998 mx-auto flex max-w-2xl flex-col gap-4 rounded-3xl border border-border bg-(--surface-strong) p-5 text-sm text-text-primary shadow-[0_20px_70px_rgba(0,0,0,0.3)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <p className="text-base font-semibold">{isUpdating ? 'Updating SportZoneBD...' : updateRegistration && !isUpdateDismissed ? 'New version available' : isOffline ? 'You are offline.' : 'Install SportZoneBD'}</p>
            <p className="mt-1 text-sm leading-6 text-text-muted">{isUpdating ? 'Please wait while the app reloads.' : updateRegistration && !isUpdateDismissed ? 'A new app version is ready to install.' : isOffline ? 'Cached app resources remain available. Live data needs a connection.' : 'Get a faster, app-like experience.'}</p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
            {isUpdating ? <span role="status" aria-live="polite" className="sr-only">Updating SportZoneBD. Please wait.</span> : updateRegistration && !isUpdateDismissed ? <><Button type="button" className="min-h-11 w-full sm:w-auto" onClick={applyUpdate}>Update now</Button><Button type="button" variant="ghost" className="min-h-11 w-full gap-2 sm:w-auto" onClick={dismissUpdate} aria-label="Dismiss update notice"><X className="h-4 w-4" aria-hidden="true" />Later</Button></> : installPrompt && !isInstalled ? <><Button type="button" className="min-h-11 w-full gap-2 sm:w-auto" onClick={() => void pwaExperience.installApp()}><Download className="h-4 w-4" aria-hidden="true" />Install App</Button><Button type="button" variant="ghost" className="min-h-11 w-full gap-2 sm:w-auto" onClick={() => { writeSessionFlag(INSTALL_DISMISSED_KEY, true); setInstallPrompt(null) }} aria-label="Dismiss install prompt"><X className="h-4 w-4" aria-hidden="true" />Later</Button></> : null}
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