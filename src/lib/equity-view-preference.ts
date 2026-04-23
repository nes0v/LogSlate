// Default equity-chart view (Line vs Candles) — persisted to localStorage
// and scoped per account, so each trading account can have its own preferred
// shape. Keys follow the pattern `logslate:equity_view_default:{accountId}`.
// Follows the same external-store pattern as active-account.

import { useSyncExternalStore } from 'react'
import type { EquityView } from '@/components/EquityChartToggle'
import { getActiveAccountId, useActiveAccountId } from '@/lib/active-account'

const KEY_PREFIX = 'logslate:equity_view_default:'
const DEFAULT: EquityView = 'curve'

function keyFor(accountId: string): string {
  return KEY_PREFIX + accountId
}

function isEquityView(v: unknown): v is EquityView {
  return v === 'curve' || v === 'candles'
}

function load(accountId: string): EquityView {
  try {
    const v = localStorage.getItem(keyFor(accountId))
    return isEquityView(v) ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

const listeners = new Set<() => void>()

export function getDefaultEquityView(accountId: string = getActiveAccountId()): EquityView {
  return load(accountId)
}

export function setDefaultEquityView(
  view: EquityView,
  accountId: string = getActiveAccountId(),
): void {
  const prev = load(accountId)
  if (view === prev) return
  try {
    localStorage.setItem(keyFor(accountId), view)
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

/** Reactive read scoped to the currently active account. */
export function useDefaultEquityView(): EquityView {
  const accountId = useActiveAccountId()
  return useSyncExternalStore(
    subscribe,
    () => load(accountId),
    () => DEFAULT,
  )
}
