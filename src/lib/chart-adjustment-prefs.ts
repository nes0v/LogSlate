import { useSyncExternalStore } from 'react'
import { loadJsonFromStorage, saveJsonToStorage } from '@/lib/storage'

// Which adjustment markers are drawn on the equity chart. These toggle
// the *labels/lines* on the curve only — the equity curve itself always
// reflects every real cash flow (deposits, withdrawals, fees), since
// that is the actual account equity.
export interface ChartAdjustmentPrefs {
  /** Deposit & withdrawal markers. */
  deposits: boolean
  /** Monthly broker-fee markers. */
  fees: boolean
}

const KEY = 'logslate:chart-adjustment-prefs'

// Fees default off — they cluster at month starts and clutter the curve;
// deposits/withdrawals are sparse and informative, so default on.
const DEFAULTS: ChartAdjustmentPrefs = { deposits: true, fees: false }

function validate(raw: unknown): ChartAdjustmentPrefs | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.deposits !== 'boolean' || typeof r.fees !== 'boolean') return null
  return { deposits: r.deposits, fees: r.fees }
}

let current = loadJsonFromStorage(KEY, validate, DEFAULTS)
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getChartAdjustmentPrefs(): ChartAdjustmentPrefs {
  return current
}

export function setChartAdjustmentPref(key: keyof ChartAdjustmentPrefs, value: boolean): void {
  current = { ...current, [key]: value }
  saveJsonToStorage(KEY, current)
  for (const cb of listeners) cb()
}

export function useChartAdjustmentPrefs(): ChartAdjustmentPrefs {
  return useSyncExternalStore(subscribe, getChartAdjustmentPrefs, getChartAdjustmentPrefs)
}
