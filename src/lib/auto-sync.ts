// Drives Drive sync from local state changes. Every trade/adjustment/account
// write debounces a push; any transition into `signed-in` (app boot with a
// valid token, fresh sign-in) plus every `online` event triggers a pull+push.
//
// The `isSyncing` guard stops the sync's own DB writes (`clear` + `bulkAdd`
// on merge) from re-scheduling a follow-up sync — otherwise bulkAdd on 100
// trades would fire 100 creating hooks and loop.

import { useSyncExternalStore } from 'react'
import { db } from '@/db/schema'
import { DriveScopeError, getDriveState, subscribeDrive, type DriveStatus } from '@/lib/drive'
import { drainPendingUploads } from '@/lib/drive-images'
import { pushError } from '@/lib/notifications'
import { syncNow, type SyncResult } from '@/lib/sync'

export type AutoSyncStatus = 'idle' | 'syncing' | 'error'

export interface AutoSyncState {
  status: AutoSyncStatus
  error: string | null
}

const DEBOUNCE_MS = 3000

let state: AutoSyncState = { status: 'idle', error: null }
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(fn => fn())
}

function update(patch: Partial<AutoSyncState>): void {
  // Skip when the patch changes no field — every subscriber would otherwise
  // re-render for an identical state (the sync loop flips status/error to
  // the same values multiple times under normal operation).
  let changed = false
  for (const k of Object.keys(patch) as Array<keyof AutoSyncState>) {
    if (state[k] !== patch[k]) {
      changed = true
      break
    }
  }
  if (!changed) return
  state = { ...state, ...patch }
  notify()
}

export function getAutoSyncState(): AutoSyncState {
  return state
}

function subscribeAutoSync(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useAutoSyncState(): AutoSyncState {
  return useSyncExternalStore(subscribeAutoSync, getAutoSyncState, getAutoSyncState)
}

let isSyncing = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function runSync(): Promise<SyncResult | null> {
  if (isSyncing) return null
  isSyncing = true
  update({ status: 'syncing', error: null })
  try {
    // Drain any screenshots that were queued while offline before we push
    // the sync file — the Drive ids land in trade records and go out with
    // this same push.
    await drainPendingUploads()
    const result = await syncNow()
    update({ status: 'idle', error: null })
    return result
  } catch (e) {
    const message = (e as Error).message ?? String(e)
    update({ status: 'error', error: message })
    if (e instanceof DriveScopeError) {
      pushError(message, { label: 'Reconnect', to: '/settings' })
    } else {
      pushError(`Drive sync failed: ${message}`, { label: 'Settings', to: '/settings' })
    }
    return null
  } finally {
    isSyncing = false
  }
}

async function runSyncIfOnline(): Promise<void> {
  if (getDriveState().status !== 'signed-in') return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  await runSync()
}

// Used by the manual "Sync now" button in Settings. Shares the isSyncing
// lock with auto-sync so hook-driven writes from this call don't trigger a
// follow-up push.
export async function requestManualSync(): Promise<SyncResult | null> {
  return runSync()
}

function schedulePush(): void {
  if (isSyncing) return
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runSyncIfOnline()
  }, DEBOUNCE_MS)
}

let initialized = false
let lastDriveStatus: DriveStatus | null = null

export function initAutoSync(): void {
  if (initialized) return
  initialized = true

  const onWrite = () => {
    if (isSyncing) return
    schedulePush()
  }

  for (const table of [db.trades, db.adjustments, db.accounts]) {
    table.hook('creating', onWrite)
    table.hook('updating', onWrite)
    table.hook('deleting', onWrite)
  }

  lastDriveStatus = getDriveState().status
  if (lastDriveStatus === 'signed-in') {
    void runSyncIfOnline()
  }
  subscribeDrive(() => {
    const s = getDriveState().status
    if (lastDriveStatus !== 'signed-in' && s === 'signed-in') {
      void runSyncIfOnline()
    }
    lastDriveStatus = s
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void runSyncIfOnline()
    })
  }
}
