// Tracks which account is currently active in the UI. Persisted to
// localStorage so reloads keep the user on the same account. Exposed as an
// external store so every component that reads the active id re-renders
// atomically when it changes.
//
// Falls back to MAIN_ACCOUNT_ID only when nothing is remembered. It does NOT
// verify the remembered id still resolves to a real account — that would mean
// reading the accounts table, which this store deliberately doesn't know
// about. Nothing can currently strand it: the panel refuses to delete the
// active account, and this is a single-device app. If that ever changes, the
// repair belongs where the account list loads, not here. Worth knowing because
// a stranded id degrades quietly rather than loudly — `useStartingBalance`
// resolves a missing account to a 0 opening balance.

import { useSyncExternalStore } from 'react'
import { MAIN_ACCOUNT_ID } from '@/db/types'

const STORAGE_KEY = 'logslate:active_account'

function load(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v && v.length > 0 ? v : MAIN_ACCOUNT_ID
  } catch {
    return MAIN_ACCOUNT_ID
  }
}

let current: string = load()
const listeners = new Set<() => void>()

export function getActiveAccountId(): string {
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
