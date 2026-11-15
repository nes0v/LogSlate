// Tracks which account is currently active in the UI. Persisted to
// localStorage so reloads keep the user on the same account. Exposed as an
// external store so every component that reads the active id re-renders
// atomically when it changes.
//
// Returns '' when nothing is remembered. It does NOT verify the remembered id
// still resolves to a real account — that would mean reading the accounts
// table, which this store deliberately doesn't know about. `Layout` does that
// repair where the account list loads, and holds the pages back until it has.

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'logslate:active_account'

function load(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ?? ''
  } catch {
    return ''
  }
}

let current: string = load()
const listeners = new Set<() => void>()

export function getActiveAccountId(): string {
  return current
}

/** The active id for a write. Throws instead of tagging a row with no account:
 *  such a row belongs to nothing, so no page shows it and no delete clears it. */
export function requireActiveAccountId(): string {
  if (!current) throw new Error('No account is selected.')
  return current
}

export function setActiveAccountId(id: string): void {
  if (id === current) return
  current = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // localStorage unavailable — in-memory state still works for this session.
  }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useActiveAccountId(): string {
  return useSyncExternalStore(subscribe, getActiveAccountId, getActiveAccountId)
}
