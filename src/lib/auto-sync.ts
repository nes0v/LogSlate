// Surfaces sync state to the UI and runs the manual sync engine. There is
// NO auto-sync — no boot sync, no per-write debounce, no online-event push,
// no Drive-status-change push. The user explicitly chose manual-only.
//
// Single device by default; if a second device is ever added the user does
// a manual sync there too. The Settings page's "Sync now" button is the
// only entry point.

import { useSyncExternalStore } from 'react'
import { DriveScopeError } from '@/lib/drive'
import { drainPendingUploads } from '@/lib/drive-images'
import { pushError } from '@/lib/notifications'
import {
  DriveAccountMismatchError,
  DriveFileGoneError,
  syncNow,
  type SyncOptions,
  type SyncResult,
} from '@/lib/sync'

export type AutoSyncStatus = 'idle' | 'syncing' | 'error'

/** Disambiguates `error` so the Settings UI can render targeted actions
 *  (hard-block vs offer-recreate) without string-matching the message. */
export type AutoSyncErrorKind =
  | 'generic'
  | 'scope'
  | 'account-mismatch'
  | 'file-gone'

export interface AutoSyncState {
  status: AutoSyncStatus
  error: string | null
  errorKind: AutoSyncErrorKind | null
  /** Per-table summary from the most recent successful run. Held across
   *  later runs so the Settings page can keep the previous summary
   *  visible while the next sync is in flight or has just errored. */
  lastResult: SyncResult | null
}

let state: AutoSyncState = {
  status: 'idle',
  error: null,
  errorKind: null,
  lastResult: null,
}
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(fn => fn())
}

function update(patch: Partial<AutoSyncState>): void {
  // Skip when the patch changes no field — every subscriber would otherwise
  // re-render for an identical state.
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

async function runSync(options: SyncOptions = {}): Promise<SyncResult | null> {
  if (isSyncing) return null
  isSyncing = true
  update({ status: 'syncing', error: null, errorKind: null })
  try {
    // Drain any screenshots queued while offline before pushing the sync
    // file — the Drive ids land in trade records and go out with this push.
    await drainPendingUploads()
    const result = await syncNow(options)
    update({ status: 'idle', error: null, errorKind: null, lastResult: result })
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (e instanceof DriveAccountMismatchError) {
      // Hard-block. NO push notification — the Settings page renders an
      // inline modal that can't be dismissed by walking away. Auto-routing
      // through the notification banner could lull the user into clicking
      // through and triggering a wipe.
      update({ status: 'error', error: message, errorKind: 'account-mismatch' })
    } else if (e instanceof DriveFileGoneError) {
      // Recoverable — the Settings page surfaces a "Recreate" action.
      update({ status: 'error', error: message, errorKind: 'file-gone' })
    } else if (e instanceof DriveScopeError) {
      update({ status: 'error', error: message, errorKind: 'scope' })
      pushError(message, { label: 'Reconnect', to: '/settings' })
    } else {
      update({ status: 'error', error: message, errorKind: 'generic' })
      pushError(`Drive sync failed: ${message}`, { label: 'Settings', to: '/settings' })
    }
    return null
  } finally {
    isSyncing = false
  }
}

/** Triggered by the "Sync now" button in Settings. `options` lets the UI
 *  pass through user-confirmed overrides (e.g. recreate a missing remote). */
export async function requestManualSync(
  options: SyncOptions = {},
): Promise<SyncResult | null> {
  return runSync(options)
}

/** Reset the surfaced auto-sync state. Called on Drive sign-out so a stale
 *  summary or error from the previous account doesn't linger in the UI. */
export function clearAutoSyncState(): void {
  update({ status: 'idle', error: null, errorKind: null, lastResult: null })
}
