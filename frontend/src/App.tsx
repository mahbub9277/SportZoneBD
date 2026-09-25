import { useEffect, useMemo, useRef, useState } from 'react'
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

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaUpdateDetail {
  waiting?: ServiceWorker | null
}

export function App() {
  const { isLoading } = useInitialLoad()
  const isAdmin = useAppSelector(selectIsAdmin)
  const { data: settings = [] } = useGetAdminSettingsQuery(undefined, { skip: !isAdmin })
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const installDismissedRef = useRef(false)

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    const handleInstallable = (event: Event) => {
      if (window.matchMedia('(display-mode: standalone)').matches || installDismissedRef.current) return
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => setInstallPrompt(null)
    const handleUpdateAvailable = (event: Event) => {
      const registration = (event as CustomEvent<PwaUpdateDetail>).detail
      if (registration) setUpdateRegistration(registration as ServiceWorkerRegistration)
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
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    const result = await installPrompt.userChoice
    if (result.outcome === 'accepted') setInstallPrompt(null)
  }

  const handleUpdate = () => {
    const waitingWorker = updateRegistration?.waiting
    if (!waitingWorker) return
    const reload = () => window.location.reload()
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
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
    <>
      {(isOffline || installPrompt || updateRegistration) && (
        <div className="fixed inset-x-3 bottom-4 z-9998 mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-border bg-(--surface-strong) p-4 text-sm text-text-primary shadow-[0_20px_70px_rgba(0,0,0,0.35)] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">{updateRegistration ? 'A new version of SportZoneBD is ready.' : isOffline ? 'You are offline.' : 'Install SportZoneBD'}</p>
            <p className="mt-1 text-xs text-text-muted">{updateRegistration ? 'Update now to load the latest app safely.' : isOffline ? 'Cached app resources remain available. Live data needs a connection.' : 'Get a faster launch from your home screen.'}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {updateRegistration ? <Button type="button" size="sm" onClick={handleUpdate}>Update</Button> : installPrompt ? <Button type="button" size="sm" onClick={() => void handleInstall}>Install</Button> : null}
            {!isOffline && !updateRegistration && installPrompt && <Button type="button" variant="ghost" size="sm" onClick={() => { installDismissedRef.current = true; setInstallPrompt(null) }}>Later</Button>}
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
    </>
  )
}