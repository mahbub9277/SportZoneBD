import React, { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { dismissNotification, selectNotifications } from './notifications.slice'

const notificationStyles = {
  info: 'bg-blue-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
}

export const NotificationContainer: React.FC = () => {
  const notifications = useAppSelector(selectNotifications)
  const dispatch = useAppDispatch()

  return (
    <div className="fixed bottom-5 right-5 z-50 space-y-2">
      {notifications.map((notification) => (
        <NotificationToast key={notification.id} notification={notification} onDismiss={() => dispatch(dismissNotification(notification.id))} />
      ))}
    </div>
  )
}

interface NotificationToastProps {
  notification: ReturnType<typeof selectNotifications>[0]
  onDismiss: () => void
}

const NotificationToast: React.FC<NotificationToastProps> = ({ notification, onDismiss }) => { // Fix: Add type annotation for 'notification'
  useEffect(() => { 
    const duration = notification.duration ?? 5000
    const timer = setTimeout(() => {
      onDismiss()
    }, duration)

    return () => clearTimeout(timer)
  }, [notification.id, notification.duration, onDismiss])

  return (
    <div
      className={`flex max-w-[calc(100vw-2rem)] items-start justify-between gap-4 rounded-xl border border-white/15 p-4 text-sm text-white shadow-[0_18px_50px_rgba(0,0,0,0.3)] backdrop-blur-lg transition-all sm:max-w-sm ${
        notificationStyles[notification.type as keyof typeof notificationStyles]
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="min-w-0 wrap-break-word">{notification.message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="shrink-0 rounded-md px-2 py-1 font-semibold hover:bg-black/10">
        ×
      </button>
    </div>
  )
}