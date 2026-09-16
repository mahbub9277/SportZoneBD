import { useMemo } from 'react'
import { RouterProvider } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { router } from '@/routes'
import { SplashScreen } from '@/components/ui/SplashScreen'
import { Toaster } from 'sonner'
import { useGetAdminSettingsQuery } from './features/admin/admin.api'
import { useInitialLoad } from './hooks/useInitialLoad'
import { useAppSelector } from './app/hooks'
import { selectIsAdmin } from './features/auth/auth.slice'

export function App() {
  const { isLoading } = useInitialLoad()
  const isAdmin = useAppSelector(selectIsAdmin)
  const { data: settings = [] } = useGetAdminSettingsQuery(undefined, { skip: !isAdmin })

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