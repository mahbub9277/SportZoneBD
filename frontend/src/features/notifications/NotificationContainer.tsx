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
    const duration = notification.duration ?? 5000 // Default to 5 seconds
    const timer = setTimeout(() => {
      onDismiss()
    }, duration)

    return () => clearTimeout(timer)
  }, [notification, onDismiss])

  return (
    <div
      className={`flex items-center justify-between rounded-md p-4 text-white shadow-lg transition-all ${
        notificationStyles[notification.type as keyof typeof notificationStyles]
      }`}
    >
      <span>{notification.message}</span>
      <button onClick={onDismiss} className="ml-4 font-bold">
        &times;
      </button>
    </div>
  )
}