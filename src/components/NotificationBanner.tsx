import { Link } from 'react-router-dom'
import { AlertCircle, Info, X } from 'lucide-react'
import {
  dismissNotification,
  useNotifications,
  type Notification,
} from '@/lib/notifications'
import { cn } from '@/lib/utils'

export function NotificationBanner() {
  const items = useNotifications()
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2 -mt-2 mb-6">
      {items.map(n => (
        <NotificationRow key={n.id} notification={n} />
      ))}
    </div>
  )
}

function NotificationRow({ notification }: { notification: Notification }) {
  const Icon = notification.kind === 'error' ? AlertCircle : Info
  return (
    <div
      role={notification.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 px-3 py-2 rounded-md border',
        notification.kind === 'error'
          ? 'bg-(--color-panel) border-(--color-loss)/40 text-(--color-text)'
          : 'bg-(--color-panel) border-(--color-border) text-(--color-text)',
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0 mt-0.5',
          notification.kind === 'error' ? 'text-(--color-loss)' : 'text-(--color-text-dim)',
        )}
      />
      <div className="flex-1 text-sm">{notification.message}</div>
      {notification.action?.to && (
        <Link
          to={notification.action.to}
          onClick={() => dismissNotification(notification.id)}
          className="text-sm text-(--color-accent) hover:underline whitespace-nowrap"
        >
          {notification.action.label}
        </Link>
      )}
      {notification.action?.onClick && (
        <button
          type="button"
          onClick={() => {
            notification.action?.onClick?.()
            dismissNotification(notification.id)
          }}
          className="text-sm text-(--color-accent) hover:underline whitespace-nowrap"
        >
          {notification.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissNotification(notification.id)}
        aria-label="Dismiss"
        className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
