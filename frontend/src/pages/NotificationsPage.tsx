import { useState } from 'react'
import { ArrowUpRight, BellRing, CheckCircle, AlertTriangle, Info, Loader2, Trash2 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useDeleteAllNotificationsMutation, useDeleteNotificationMutation, useGetNotificationsQuery, useMarkAllNotificationsAsReadMutation, useMarkNotificationAsReadMutation } from '../features/notifications/notification.api'
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

export function NotificationsPage() {
  const [page, setPage] = useState(1)
  const shouldReduceMotion = useReducedMotion()
  const { data, isLoading, isFetching, isError, refetch } = useGetNotificationsQuery({ page, limit: 25 })
  const [markAllAsRead, { isLoading: isMarkingAllAsRead }] = useMarkAllNotificationsAsReadMutation()
  const [markAsRead, { isLoading: isMarkingIndividual, originalArgs }] = useMarkNotificationAsReadMutation()
  const [deleteNotification, { isLoading: isDeletingNotification, originalArgs: deletingNotificationId }] = useDeleteNotificationMutation()
  const [deleteAllNotifications, { isLoading: isDeletingAll }] = useDeleteAllNotificationsMutation()

  const notifications: Notification[] = data?.items ?? []
  const totalPages = data?.meta?.totalPages ?? 1

  const handlePrevious = () => {
    setPage((prev) => Math.max(prev - 1, 1))
  }

  const handleNext = () => {
    setPage((prev) => Math.min(prev + 1, totalPages))
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="app-page w-full min-w-0 space-y-3 px-4 pb-8 sm:px-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="app-page-section flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-(--text-primary)">Notifications</h1>
        <div className="flex items-center gap-2">
          {notifications.some((n) => !n.isRead) && <Button variant="outline" size="sm" onClick={() => markAllAsRead()} disabled={isMarkingAllAsRead} isLoading={isMarkingAllAsRead}>{isMarkingAllAsRead ? 'Marking as read...' : 'Mark all as read'}</Button>}
          {notifications.length > 0 && <Button type="button" variant="ghost" size="icon" onClick={() => deleteAllNotifications()} disabled={isDeletingAll} aria-label="Delete all notifications" title="Delete all notifications"><Trash2 className={cn('h-4 w-4', isDeletingAll && 'animate-pulse')} /></Button>}
        </div>
      </motion.div>

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
          <p>We'll let you know when there's something new.</p>
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
                  <Card className={cn('flex items-start gap-3 p-4', !notification.isRead && 'bg-(--surface-strong)')}>
                    <div className="shrink-0">
                      {notificationIcons[notification.type as NotificationType] ?? notificationIcons.default}
                    </div>
                    <div className="min-w-0 flex-1">
                      {notification.match && <div className="mb-2 flex min-w-0 items-center gap-2 text-xs text-(--text-muted)">
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