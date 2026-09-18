import { startTransition, useEffect, useState } from 'react'
import { Palette, User, Bell } from 'lucide-react'
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
import { getErrorMessage } from '../utils/get-error-message'

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

  useEffect(() => {
    const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    startTransition(() => {
      setPushSupported(supportsPush)
      setPushPermission(supportsPush ? Notification.permission : 'unsupported')
    })
  }, [])

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

      if (!existingSubscription) {
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(
            atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'))
              .split('')
              .map((char) => char.charCodeAt(0)),
          ),
        })

        await registerPushSubscription({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...Array.from(new Uint8Array(subscription.getKey('p256dh')!)))),
            auth: btoa(String.fromCharCode(...Array.from(new Uint8Array(subscription.getKey('auth')!)))),
          },
        }).unwrap()
      }

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

      setPushPermission('default')
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
    { key: 'matchStartPush', label: 'Match Started (In-app)', description: 'Show an in-app alert when a match goes live.' },
    { key: 'newHighlightPush', label: 'New Highlights (In-app)', description: 'Show an in-app alert when a new highlight is added.' },
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
            <Label className="font-medium">Browser Push Notifications</Label>
            <p className="text-xs text-(--text-muted)">
              {pushSupported
                ? pushPermission === 'granted'
                  ? 'Push notifications are enabled on this device.'
                  : 'Enable desktop/browser push alerts for match and highlight updates.'
                : 'This browser does not support push notifications.'}
            </p>
          </div>
          <Button
            variant={pushPermission === 'granted' ? 'outline' : 'default'}
            size="sm"
            disabled={!pushSupported || isRegisteringPush || isUnregisteringPush}
            onClick={() => (pushPermission === 'granted' ? disableBrowserPush() : enableBrowserPush())}
          >
            {pushPermission === 'granted' ? 'Disable' : 'Enable'}
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
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="app-page space-y-3">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="app-page-section">
        <h1 className="text-lg font-medium">Settings</h1>
        <p className="text-sm text-brand-text-muted">
          Manage your account settings and set e-mail preferences.
        </p>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="app-page-section space-y-3">
        <ProfileSettings />
        <AppearanceSettings />
        <NotificationSettings />
      </motion.div>
    </motion.div>
  )
}