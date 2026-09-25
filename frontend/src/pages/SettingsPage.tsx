import { startTransition, useEffect, useState } from 'react'
import { ArrowLeft, Info, Palette, User, Bell } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Switch } from '../components/ui/Switch'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../hooks/common/layouts/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { useUpdateMyProfileMutation, useGetNotificationPreferencesQuery, useUpdateNotificationPreferencesMutation } from '../features/users/users.api'
import { useRegisterPushSubscriptionMutation, useUnregisterPushSubscriptionMutation } from '../features/notifications/notification.api'
import { decodeVapidPublicKey, serializePushSubscription, supportsWebPush } from '../features/notifications/pushSubscription'
import { getErrorMessage } from '../utils/get-error-message'
import { AboutSportZoneBD } from '../features/pwa/AboutSportZoneBD'
import { APP_VERSION } from '../features/pwa/appInfo'

function ProfileSettings() {
  const { user } = useAuth()
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [updateProfile, { isLoading, isSuccess, isError, error }] = useUpdateMyProfileMutation()

  useEffect(() => {
    if (isSuccess) {
      toast.success('Profile updated successfully!')
    }
    if (isError) {
      toast.error('Failed to update profile', {
        description: getErrorMessage(error),
      })
    }
  }, [isSuccess, isError, error])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim() || fullName.trim() === user?.fullName) return
    await updateProfile({ fullName })
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}><Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <motion.div className="p-1.5 bg-linear-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}>
            <User size={18} className="text-white" />
          </motion.div>
          Profile Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input id="email" value={user?.email ?? ''} disabled />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={isLoading || !fullName.trim() || fullName.trim() === user?.fullName}>
              Save Changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card></motion.div>
  )
}

function AppearanceSettings() {
  const { theme, toggleTheme } = useTheme()

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}><Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <motion.div className="p-1.5 bg-linear-to-br from-purple-400 to-purple-600 rounded-lg flex items-center justify-center" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}>
            <Palette size={18} className="text-white" />
          </motion.div>
          Appearance
        </CardTitle>
        <CardDescription>
          Customize the look and feel of the application.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border border-(--border) p-4">
          <div>
            <Label htmlFor="dark-mode-toggle" className="font-medium">
              Dark Mode
            </Label>
            <p className="text-xs text-(--text-muted)">Toggle between light and dark themes.</p>
          </div>
          <Switch id="dark-mode-toggle" checked={theme === 'dark'} onCheckedChange={toggleTheme} />
        </div>
      </CardContent>
    </Card></motion.div>
  )
}

function NotificationSettings() {
  const { data: preferences, isLoading } = useGetNotificationPreferencesQuery()
  const [updatePreferences, { isLoading: isSaving }] = useUpdateNotificationPreferencesMutation()
  const [registerPushSubscription, { isLoading: isRegisteringPush }] = useRegisterPushSubscriptionMutation()
  const [unregisterPushSubscription, { isLoading: isUnregisteringPush }] = useUnregisterPushSubscriptionMutation()
  const [pushSupported, setPushSupported] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [pushEnabled, setPushEnabled] = useState(false)

  useEffect(() => {
    const supportsPush = supportsWebPush()
    startTransition(() => {
      setPushSupported(supportsPush)
      setPushPermission(supportsPush ? Notification.permission : 'unsupported')
    })

    if (!supportsPush) return
    let active = true
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        if (!active || !subscription) return
        await registerPushSubscription(serializePushSubscription(subscription)).unwrap()
        if (active) setPushEnabled(true)
      })
      .catch(() => {
        if (active) setPushEnabled(false)
      })

    return () => {
      active = false
    }
  }, [registerPushSubscription])

  const enableBrowserPush = async () => {
    if (!pushSupported) {
      toast.error('Push notifications are not supported in this browser.')
      return
    }

    try {
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setPushPermission(permission)
          toast.error('Push notification permission was not granted.')
          return
        }
      }

      if (Notification.permission === 'denied') {
        toast.error('Push notifications are blocked for this browser.')
        setPushPermission('denied')
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await registration.update()

      const existingSubscription = await registration.pushManager.getSubscription()
      const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined

      if (!publicKey) {
        throw new Error('Missing VAPID public key for browser push notifications.')
      }

      const subscription = existingSubscription ?? await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(publicKey),
        })

      await registerPushSubscription(serializePushSubscription(subscription)).unwrap()

      setPushEnabled(true)
      setPushPermission('granted')
      toast.success('Browser push notifications enabled.')
    } catch (error) {
      console.error(error)
      toast.error('Could not enable browser push notifications.', {
        description: getErrorMessage(error),
      })
    }
  }

  const disableBrowserPush = async () => {
    try {
      const registration = await navigator.serviceWorker.ready
      const existingSubscription = await registration.pushManager.getSubscription()

      if (existingSubscription) {
        await unregisterPushSubscription({ endpoint: existingSubscription.endpoint }).unwrap()
        await existingSubscription.unsubscribe()
      }

      setPushEnabled(false)
      toast.success('Browser push notifications disabled.')
    } catch (error) {
      console.error(error)
      toast.error('Could not disable browser push notifications.', {
        description: getErrorMessage(error),
      })
    }
  }

  const handlePreferenceChange = async (key: keyof NonNullable<typeof preferences>, value: boolean) => {
    const promise = updatePreferences({ [key]: value }).unwrap()

    toast.promise(promise, {
      loading: 'Saving preferences...',
      success: 'Preferences saved!',
      error: (err) => `Failed to save: ${getErrorMessage(err)}`,
    })
  }

  const preferenceItems = [
    { key: 'matchStartPush', label: 'Match start browser push', description: 'Allow browser or installed-PWA push when a match starts. In-app inbox alerts are separate.' },
    { key: 'newHighlightPush', label: 'New highlight browser push', description: 'Allow browser or installed-PWA push for new highlights. In-app inbox alerts are separate.' },
    { key: 'matchStartEmail', label: 'Match Start (Email)', description: 'Get an email when a followed match is about to start.' },
    { key: 'newHighlightEmail', label: 'New Highlights (Email)', description: 'Get an email when new highlights are available.' },
  ] as const;

  if (isLoading) {
    return <Card><CardHeader><CardTitle>Loading Notification Settings...</CardTitle></CardHeader></Card>
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}><Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <motion.div className="p-1.5 bg-linear-to-br from-orange-400 to-orange-600 rounded-lg flex items-center justify-center" whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}>
            <Bell size={18} className="text-white" />
          </motion.div>
          Notifications
        </CardTitle>
        <CardDescription>
          Configure how you receive notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border border-(--border) p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Label className="font-medium">Browser / installed app push</Label>
            <p className="text-xs text-(--text-muted)">
              {pushSupported
                ? pushEnabled
                  ? 'Push is enabled on this device. In-app inbox notifications remain separate.'
                  : pushPermission === 'denied'
                    ? 'Permission is blocked by the browser. Change this site’s notification permission to enable push.'
                    : 'Optional match and highlight alerts for this browser or installed PWA. In-app notifications work without enabling push.'
                : 'This browser does not support push notifications.'}
            </p>
          </div>
          <Button
            variant={pushEnabled ? 'outline' : 'default'}
            size="sm"
            disabled={!pushSupported || pushPermission === 'denied' || isRegisteringPush || isUnregisteringPush}
            onClick={() => (pushEnabled ? disableBrowserPush() : enableBrowserPush())}
          >
            {isRegisteringPush || isUnregisteringPush ? 'Updating...' : pushEnabled ? 'Disable push' : pushPermission === 'denied' ? 'Blocked' : 'Enable push'}
          </Button>
        </div>

        {preferenceItems.map(item => (
          <div key={item.key} className="flex flex-col gap-3 rounded-lg border border-(--border) p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Label htmlFor={item.key} className="font-medium">
                {item.label}
              </Label>
              <p className="text-xs text-(--text-muted)">{item.description}</p>
            </div>
            <Switch
              id={item.key}
              checked={preferences?.[item.key] ?? false}
              disabled={isSaving}
              onCheckedChange={(checked) => handlePreferenceChange(item.key, checked === true)}
            />
          </div>
        ))}
      </CardContent>
    </Card></motion.div>
  )
}

export function SettingsPage() {
  const [showAbout, setShowAbout] = useState(false)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="app-page space-y-3">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="app-page-section">
        {showAbout ? (
          <div className="flex items-start gap-3">
            <Button type="button" variant="ghost" size="icon" className="-ml-2 min-h-10 min-w-10" onClick={() => setShowAbout(false)} aria-label="Back to settings"><ArrowLeft className="h-5 w-5" /></Button>
            <div><h1 className="text-lg font-medium">About SportZoneBD</h1><p className="text-sm text-brand-text-muted">App information, updates, and legal details.</p></div>
          </div>
        ) : (
          <><h1 className="text-lg font-medium">Settings</h1><p className="text-sm text-brand-text-muted">Manage your account settings and set e-mail preferences.</p></>
        )}
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="app-page-section space-y-3">
        {showAbout ? <AboutSportZoneBD /> : <>
          <ProfileSettings />
          <AppearanceSettings />
          <NotificationSettings />
          <Card>
            <button type="button" onClick={() => setShowAbout(true)} className="flex min-h-16 w-full items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)" aria-label={`About SportZoneBD, version ${APP_VERSION}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-(--accent)/10 text-(--accent)"><Info className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-(--text-primary)">About SportZoneBD</span><span className="mt-1 block text-xs text-(--text-muted)">Version {APP_VERSION} · App info, updates and legal</span></span>
            </button>
          </Card>
        </>}
      </motion.div>
    </motion.div>
  )
}