import { useEffect, useState } from 'react'
import { Palette, User, Bell } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card'
import { Switch } from '../components/ui/Switch'
import { useTheme } from '../hooks/useTheme'
import { Button } from '../components/ui/Button'
import { Label } from '../components/ui/Label'
import { useGetMeQuery, useUpdateProfileMutation } from '../features/auth/auth.api'
import { useGetNotificationPreferencesQuery, useUpdateNotificationPreferencesMutation, type NotificationPreferences } from '../features/users/users.api'
import { useRegisterPushSubscriptionMutation, useUnregisterPushSubscriptionMutation } from '../features/notifications/notification.api'
import { decodeVapidPublicKey, serializePushSubscription, supportsWebPush } from '../features/notifications/pushSubscription'
import { EditProfileForm } from './user/components/EditProfileForm'

function ProfileSettings() {
  const { data: user, isError, isLoading, refetch } = useGetMeQuery()
  const [updateProfile, { isLoading: isSaving }] = useUpdateProfileMutation()
  const [formKey, setFormKey] = useState(0)
  const [avatarUploadPercent, setAvatarUploadPercent] = useState<number | null>(null)

  const handleSubmit = (formData: FormData) => {
    // The avatar travels through the API, so its transfer progress is reported while it is sent.
    const request = updateProfile({ formData, onProgress: setAvatarUploadPercent })
    void request.unwrap().then(() => {
      toast.success('Profile updated.')
      setFormKey((key) => key + 1)
    }).catch(() => undefined).finally(() => setAvatarUploadPercent(null))
    return request
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}><Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><User size={18} aria-hidden="true" />Profile</CardTitle>
        <CardDescription>Update your name and profile photo. Your email address cannot be changed here.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && !user ? <p role="status" aria-live="polite" className="text-sm text-text-muted">Loading profile...</p> : user ? (
          <EditProfileForm
            key={formKey}
            user={user}
            onSubmit={handleSubmit}
            isLoading={isSaving}
            uploadPercent={avatarUploadPercent}
            onCancel={() => setFormKey((key) => key + 1)}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3" role="status">
            <p className="text-sm text-text-muted">{isError ? 'Your profile could not be loaded.' : 'Profile is unavailable.'}</p>
            <Button type="button" variant="outline" onClick={() => void refetch()}>Try again</Button>
          </div>
        )}
      </CardContent>
    </Card></motion.div>
  )
}

function AppearanceSettings() {
  const { theme, toggleTheme } = useTheme()

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}><Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Palette size={18} aria-hidden="true" />Appearance</CardTitle>
        <CardDescription>Choose between light and dark themes. Your choice is saved on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border border-(--border) p-4">
          <div>
            <Label htmlFor="dark-mode-toggle" className="font-medium">Dark mode</Label>
            <p className="text-xs text-(--text-muted)">{theme === 'dark' ? 'Dark theme is active.' : 'Light theme is active.'}</p>
          </div>
          <Switch id="dark-mode-toggle" checked={theme === 'dark'} onCheckedChange={toggleTheme} />
        </div>
      </CardContent>
    </Card></motion.div>
  )
}

function NotificationSettings() {
  const { data: preferences, isLoading, isError, refetch } = useGetNotificationPreferencesQuery()
  const [updatePreferences, { isLoading: isSaving }] = useUpdateNotificationPreferencesMutation()
  const [registerPushSubscription, { isLoading: isRegisteringPush }] = useRegisterPushSubscriptionMutation()
  const [unregisterPushSubscription, { isLoading: isUnregisteringPush }] = useUnregisterPushSubscriptionMutation()
  const pushSupported = supportsWebPush()
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(() => supportsWebPush() ? Notification.permission : 'unsupported')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [isCheckingPush, setIsCheckingPush] = useState(() => supportsWebPush())
  const [preferenceStatus, setPreferenceStatus] = useState('')
  const pushConfigured = Boolean(import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY)

  useEffect(() => {
    const supportsPush = supportsWebPush()
    let active = true

    if (!supportsPush) {
      return () => { active = false }
    }

    const checkCurrentSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (active) setPushEnabled(Boolean(subscription))
      } catch {
        if (active) setPushEnabled(false)
      } finally {
        if (active) setIsCheckingPush(false)
      }
    }
    void checkCurrentSubscription()

    return () => {
      active = false
    }
  }, [])

  const enableBrowserPush = async () => {
    if (!pushSupported) {
      toast.error('Push notifications are not supported in this browser.')
      return
    }

    try {
      let permission = Notification.permission
      if (permission === 'default') permission = await Notification.requestPermission()
      setPushPermission(permission)
      if (permission !== 'granted') {
        toast.error(permission === 'denied' ? 'Push notifications are blocked for this browser.' : 'Push notification permission was not granted.')
        return
      }

      const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined
      if (!publicKey) {
        toast.error('Browser push notifications are not configured for this site.')
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      const existingSubscription = await registration.pushManager.getSubscription()
      const subscription = existingSubscription ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidPublicKey(publicKey),
      })

      await registerPushSubscription(serializePushSubscription(subscription)).unwrap()
      setPushEnabled(true)
      toast.success('Browser push notifications enabled.')
    } catch (error) {
      if (!isApiError(error)) toast.error('Could not enable browser push notifications. Please try again.')
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
      if (!isApiError(error)) toast.error('Could not disable browser push notifications. Please try again.')
    }
  }

  const handlePreferenceChange = async (key: PushPreferenceKey, value: boolean) => {
    setPreferenceStatus('Saving preferences...')
    try {
      await updatePreferences({ [key]: value }).unwrap()
      setPreferenceStatus('Notification preference saved.')
    } catch {
      setPreferenceStatus('')
    }
  }

  if (isLoading) {
    return <Card><CardContent className="py-6"><p role="status" aria-live="polite" className="text-sm text-text-muted">Loading notification preferences...</p></CardContent></Card>
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}><Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bell size={18} aria-hidden="true" />Notifications</CardTitle>
        <CardDescription>Manage supported browser push alerts. In-app inbox notifications are separate.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3" role="status">
            <p className="text-sm text-text-muted">Notification preferences could not be loaded.</p>
            <Button type="button" variant="outline" onClick={() => void refetch()}>Try again</Button>
          </div>
        ) : <>
        <div className="flex flex-col gap-3 rounded-lg border border-(--border) p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Label htmlFor="browser-push-toggle" className="font-medium">Browser / installed app push</Label>
            <p className="text-xs text-(--text-muted)">
              {isCheckingPush ? 'Checking this browser...' : !pushSupported
                ? 'This browser does not support push notifications.'
                : pushPermission === 'denied'
                  ? 'Permission is blocked. Change this site’s browser permission to enable push.'
                  : pushEnabled
                    ? 'Push is enabled on this browser or installed app.'
                    : !pushConfigured
                      ? 'Push notifications are not configured for this site.'
                      : 'Optional match-start and highlight alerts for this browser or installed app.'}
            </p>
          </div>
          <Switch
            id="browser-push-toggle"
            checked={pushEnabled}
            disabled={!pushSupported || !pushConfigured || isCheckingPush || pushPermission === 'denied' || isRegisteringPush || isUnregisteringPush}
            aria-label="Enable browser push notifications on this device"
            onCheckedChange={(checked) => checked ? void enableBrowserPush() : void disableBrowserPush()}
          />
        </div>

        {(isRegisteringPush || isUnregisteringPush) && <p role="status" aria-live="polite" className="text-sm text-text-muted">Updating push registration...</p>}
        {pushPreferenceItems.map(item => (
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
        {preferenceStatus && <p role="status" aria-live="polite" className="text-sm text-text-muted">{preferenceStatus}</p>}
        </>}
      </CardContent>
    </Card></motion.div>
  )
}

type PushPreferenceKey = Extract<keyof NotificationPreferences, 'matchStartPush' | 'newHighlightPush'>

const pushPreferenceItems: { key: PushPreferenceKey; label: string; description: string }[] = [
  { key: 'matchStartPush', label: 'Match start alerts', description: 'Receive browser push notifications when matches start.' },
  { key: 'newHighlightPush', label: 'New highlight alerts', description: 'Receive browser push when new highlights are available.' },
]

function isApiError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error
}

export function SettingsPage() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }} className="app-page space-y-4">
      <header className="app-page-section">
        <h1 className="text-xl font-semibold text-text-primary">Settings</h1>
        <p className="mt-1 text-sm text-text-muted">Manage your profile, appearance, and supported notifications.</p>
      </header>
      <div className="app-page-section space-y-4">
        <ProfileSettings />
        <AppearanceSettings />
        <NotificationSettings />
      </div>
    </motion.div>
  )
}