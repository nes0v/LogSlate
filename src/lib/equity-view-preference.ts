// Default equity-chart view (Line vs Candles) — persisted to localStorage
// and scoped per account, so each trading account can have its own preferred
// shape. Keys follow the pattern `logslate:equity_view_default:{accountId}`.
// Follows the same external-store pattern as active-account.

import { useSyncExternalStore } from 'react'
import type { EquityView } from '@/components/EquityChartToggle'
import { getActiveAccountId, useActiveAccountId } from '@/lib/active-account'
import { removeFromStorage } from '@/lib/storage'

const KEY_PREFIX = 'logslate:equity_view_default:'
const DEFAULT: EquityView = 'candles'

function keyFor(accountId: string): string {
  return KEY_PREFIX + accountId
}

function isEquityView(v: unknown): v is EquityView {
  return v === 'curve' || v === 'candles'
}

// Choices localStorage refused to save. They win over storage for the rest
// of the session, so a choice still applies — it just isn't remembered.
const memory = new Map<string, EquityView>()

function load(accountId: string): EquityView {
  const chosen = memory.get(accountId)
  if (chosen) return chosen
  try {
    const v = localStorage.getItem(keyFor(accountId))
    return isEquityView(v) ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

const listeners = new Set<() => void>()

/** Forget an account's preference (the account is being deleted). */
export function clearDefaultEquityView(accountId: string): void {
  memory.delete(accountId)
  removeFromStorage(keyFor(accountId))
}

export function setDefaultEquityView(
  view: EquityView,
  accountId: string = getActiveAccountId(),
): void {
  const prev = load(accountId)
  if (view === prev) return
  try {
    localStorage.setItem(keyFor(accountId), view)
    memory.delete(accountId)
  } catch {
    memory.set(accountId, view)
  }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Reactive read scoped to the currently active account. */
export function useDefaultEquityView(): EquityView {
  const accountId = useActiveAccountId()
  return useSyncExternalStore(
    subscribe,
    () => load(accountId),
    () => DEFAULT,
  )
}
