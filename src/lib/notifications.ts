// App-wide notification store. Pushes show in a banner pinned below the
// header on every page so users don't need dev tools to know something
// failed. Errors stay until the user dismisses them; info notifications
// self-dismiss after a few seconds.

import { useSyncExternalStore } from 'react'

export type NotificationKind = 'error' | 'info'

export interface NotificationAction {
  label: string
  to?: string
  onClick?: () => void
}

export interface Notification {
  id: string
  kind: NotificationKind
  message: string
  action?: NotificationAction
}

const INFO_DISMISS_MS = 4000

let items: Notification[] = []
const listeners = new Set<() => void>()

function emit(next: Notification[]): void {
  items = next
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getItems(): Notification[] {
  return items
}

export function useNotifications(): Notification[] {
  return useSyncExternalStore(subscribe, getItems, getItems)
}

function newId(): string {
  return crypto.randomUUID()
}

// De-dupe by (kind, message) — repeated identical pushes (e.g. an error
// that fires on every tick of some failing loop) shouldn't stack up.
function exists(kind: NotificationKind, message: string): boolean {
  return items.some(n => n.kind === kind && n.message === message)
}

export function pushError(message: string, action?: NotificationAction): string | null {
  if (exists('error', message)) return null
  const id = newId()
  emit([...items, { id, kind: 'error', message, action }])
  return id
}

export function pushInfo(message: string): string | null {
  if (exists('info', message)) return null
  const id = newId()
  emit([...items, { id, kind: 'info', message }])
  setTimeout(() => dismissNotification(id), INFO_DISMISS_MS)
  return id
}

export function dismissNotification(id: string): void {
  const next = items.filter(n => n.id !== id)
  if (next.length === items.length) return
  emit(next)
}

export function clearNotifications(): void {
  if (items.length === 0) return
  emit([])
}
