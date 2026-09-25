import { useEffect, useState } from 'react'
import { ArrowUpRight, BellRing, CheckCircle, AlertTriangle, Info, Loader2, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useDeleteAllNotificationsMutation, useDeleteNotificationMutation, useGetNotificationsQuery, useMarkAllNotificationsAsReadMutation, useMarkNotificationAsReadMutation, useRegisterPushSubscriptionMutation } from '../features/notifications/notification.api'
import { Skeleton } from '../components/ui/Skeleton'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { cn } from '../lib/utils'
import type { Notification, NotificationType } from '../features/notifications/notification.types'
import { buildCloudinaryUrl } from '../utils/cloudinary'

const notificationIcons = {
  success: <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center"><CheckCircle className="h-5 w-5 text-green-500" /></motion.div>,
  warning: <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-yellow-500" /></motion.div>,
  error: <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-red-500" /></motion.div>,
  info: <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center"><Info className="h-5 w-5 text-blue-500" /></motion.div>,
  default: <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center"><BellRing className="h-5 w-5 text-(--text-muted)" /></motion.div>,
}

interface NotificationsPageProps {
  embedded?: boolean
  onClose?: () => void
}

type PushStatus = 'checking' | 'available' | 'enabled' | 'denied' | 'unsupported'

const decodeVapidKey = (value: string): BufferSource => {
  const normalized = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)) as unknown as BufferSource
}

export function NotificationsPage({ embedded = false, onClose }: NotificationsPageProps) {
  const [page, setPage] = useState(1)
  const [pushStatus, setPushStatus] = useState<PushStatus>('checking')
  const shouldReduceMotion = useReducedMotion()
  const { data, isLoading, isFetching, isError, refetch } = useGetNotificationsQuery({ page, limit: 25, unreadOnly: true })
  const [markAllAsRead, { isLoading: isMarkingAllAsRead }] = useMarkAllNotificationsAsReadMutation()
  const [markAsRead, { isLoading: isMarkingIndividual, originalArgs }] = useMarkNotificationAsReadMutation()
  const [deleteNotification, { isLoading: isDeletingNotification, originalArgs: deletingNotificationId }] = useDeleteNotificationMutation()
  const [deleteAllNotifications, { isLoading: isDeletingAll }] = useDeleteAllNotificationsMutation()
  const [registerPushSubscription, { isLoading: isEnablingPush }] = useRegisterPushSubscriptionMutation()

  const notifications: Notification[] = data?.items ?? []
  const totalPages = data?.meta?.totalPages ?? 1

  const handlePrevious = () => {
    setPage((prev) => Math.max(prev - 1, 1))
  }

  const handleNext = () => {
    setPage((prev) => Math.min(prev + 1, totalPages))
  }

  useEffect(() => {
    let isMounted = true

    const checkPushSubscription = async () => {
      const vapidKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
      if (!vapidKey || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (isMounted) setPushStatus('unsupported')
        return
      }

      if (Notification.permission === 'denied') {
        if (isMounted) setPushStatus('denied')
        return
      }

      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (isMounted) setPushStatus(subscription ? 'enabled' : 'available')
      } catch {
        if (isMounted) setPushStatus('unsupported')
      }
    }

    void checkPushSubscription()
    return () => {
      isMounted = false
    }
  }, [])

  const handleEnablePush = async () => {
    const vapidKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
    if (!vapidKey) return

    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'available')
        return
      }

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(vapidKey),
      })
      const subscriptionJson = subscription.toJSON()
      const p256dh = subscriptionJson.keys?.p256dh
      const auth = subscriptionJson.keys?.auth
      if (!subscriptionJson.endpoint || !p256dh || !auth) throw new Error('Incomplete push subscription')

      await registerPushSubscription({ endpoint: subscriptionJson.endpoint, keys: { p256dh, auth } }).unwrap()
      setPushStatus('enabled')
    } catch {
      setPushStatus('available')
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className={cn('w-full min-w-0 space-y-3', embedded ? 'h-full overflow-y-auto overscroll-contain p-3 sm:p-5' : 'app-page px-4 pb-8 sm:px-6 lg:p-8')}>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className={cn('flex items-center justify-between gap-3', embedded ? 'border-b border-border/70 pb-4' : 'app-page-section')}>
        <div className="min-w-0">
          <h1 className={cn('font-bold tracking-tight text-(--text-primary)', embedded ? 'text-xl' : 'text-3xl')}>Notifications</h1>
          {embedded && <p className="mt-1 text-xs text-(--text-muted)">Your latest account and match updates</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {notifications.some((n) => !n.isRead) && <Button variant="outline" size="sm" onClick={() => markAllAsRead()} disabled={isMarkingAllAsRead} isLoading={isMarkingAllAsRead}>{isMarkingAllAsRead ? 'Marking as read...' : 'Mark all as read'}</Button>}
          {notifications.length > 0 && <Button type="button" variant="ghost" size="icon" onClick={() => deleteAllNotifications()} disabled={isDeletingAll} aria-label="Delete all notifications" title="Delete all notifications"><Trash2 className={cn('h-4 w-4', isDeletingAll && 'animate-pulse')} /></Button>}
          {embedded && <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close notifications" title="Close notifications"><X className="h-5 w-5" /></Button>}
        </div>
      </motion.div>

      {pushStatus === 'available' && (
        <Card className="flex flex-col gap-3 border-accent/25 bg-accent/6 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-(--text-primary)">Turn on notifications</p>
            <p className="mt-1 text-sm text-(--text-muted)">Allow match and highlight alerts only when you choose to receive them.</p>
          </div>
          <Button type="button" className="shrink-0" onClick={() => void handleEnablePush()} disabled={isEnablingPush} isLoading={isEnablingPush}>Turn on</Button>
        </Card>
      )}
      {pushStatus === 'denied' && <p className="text-xs text-(--text-muted)">Notifications are blocked in this browser. Enable them in your site permissions to receive alerts.</p>}

      {isLoading ? (
        <div role="status" aria-live="polite" aria-label="Loading notifications" className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="flex items-start gap-4 p-4">
              <Skeleton className="h-6 w-6 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Card className="p-8 text-center text-red-400">
          <AlertTriangle className="mx-auto h-12 w-12" />
          <p className="mt-4 text-lg font-semibold">Unable to load notifications</p>
          <p>Please try again shortly.</p>
          <Button variant="outline" className="mt-4" onClick={() => refetch()} isLoading={isFetching}>Try again</Button>
        </Card>
      ) : notifications.length === 0 ? (
        <Card className="p-8 text-center text-(--text-muted)">
          <BellRing className="mx-auto h-12 w-12" />
          <p className="mt-4 text-lg font-semibold">No notifications yet</p>
          <p>We&apos;ll let you know when there&apos;s something new.</p>
        </Card>
      ) : (
        <>
          <motion.div
            className="space-y-4"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: shouldReduceMotion ? 0 : 0.05 } },
            }}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {notifications.map((notification) => (
                <motion.div
                  key={notification.id}
                  layout
                  variants={{
                    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 8 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  initial="hidden"
                  animate="visible"
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.22, ease: 'easeOut' }}
                >
                  <Card className={cn('flex min-w-0 items-start gap-2.5 p-3 sm:gap-3 sm:p-4', !notification.isRead && 'bg-(--surface-strong)')}>
                    <div className="shrink-0">
                      {notificationIcons[notification.type as NotificationType] ?? notificationIcons.default}
                    </div>
                    <div className="min-w-0 flex-1">
                      {notification.match && <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-(--text-muted) sm:gap-2">
                        {notification.match.homeTeamLogo ? <img src={buildCloudinaryUrl(notification.match.homeTeamLogo, { width: 40, height: 40, crop: 'fit' })} alt="" className="h-7 w-7 rounded-full bg-(--surface-soft) object-contain" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-(--surface-soft) text-[9px] font-bold">{notification.match.homeTeamName?.slice(0, 2).toUpperCase() || 'T1'}</span>}
                        <span className="max-w-32 wrap-break-word">{notification.match.homeTeamName || 'Team 1'}</span>
                        <span className="shrink-0 text-accent">vs</span>
                        {notification.match.awayTeamLogo ? <img src={buildCloudinaryUrl(notification.match.awayTeamLogo, { width: 40, height: 40, crop: 'fit' })} alt="" className="h-7 w-7 rounded-full bg-(--surface-soft) object-contain" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-(--surface-soft) text-[9px] font-bold">{notification.match.awayTeamName?.slice(0, 2).toUpperCase() || 'T2'}</span>}
                        <span className="max-w-32 wrap-break-word">{notification.match.awayTeamName || 'Team 2'}</span>
                      </div>}
                      {notification.link ? <a href={notification.link} target={notification.link.startsWith('/') ? undefined : '_blank'} rel={notification.link.startsWith('/') ? undefined : 'noreferrer'} className="group/link inline-flex max-w-full items-center gap-1 wrap-break-word font-semibold text-(--text-primary) transition-colors hover:text-accent hover:underline"><span className="wrap-break-word">{notification.title}</span><ArrowUpRight className="h-4 w-4 shrink-0 opacity-70 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" /></a> : <p className="wrap-break-word font-semibold text-(--text-primary)">{notification.title}</p>}
                      {notification.link ? <a href={notification.link} target={notification.link.startsWith('/') ? undefined : '_blank'} rel={notification.link.startsWith('/') ? undefined : 'noreferrer'} className="mt-1 block wrap-break-word text-sm text-(--text-muted) transition-colors hover:text-text-primary">{notification.body}</a> : <p className="wrap-break-word text-sm text-(--text-muted)">{notification.body}</p>}
                      <p className="mt-1 text-xs text-(--text-muted)">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                      {!notification.isRead && (
                        <Button
                          variant="link"
                          size="sm"
                          className="mt-2 h-auto p-0 text-xs"
                          onClick={() => !notification.isRead && markAsRead(notification.id)}
                          disabled={isMarkingIndividual && originalArgs === notification.id}
                          aria-label={`Mark notification "${notification.title}" as read`}
                        >
                          {isMarkingIndividual && originalArgs === notification.id ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                          Mark as read
                        </Button>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!notification.isRead && <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />}
                      <Button type="button" variant="ghost" size="icon" onClick={() => deleteNotification(notification.id)} disabled={isDeletingNotification && deletingNotificationId === notification.id} aria-label={`Delete notification "${notification.title}"`} title="Delete notification"><Trash2 className={cn('h-4 w-4 text-(--text-muted) hover:text-red-400', isDeletingNotification && deletingNotificationId === notification.id && 'animate-pulse')} /></Button>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <Button onClick={handlePrevious} disabled={page === 1 || isFetching}>Previous</Button>
              <span className="text-sm text-(--text-muted)">Page {page} of {totalPages}</span>
              <Button onClick={handleNext} disabled={page === totalPages || isFetching}>Next</Button>
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}