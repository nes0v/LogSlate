import { useSyncExternalStore } from 'react'

export type DefaultRangeMonths = 1 | 2 | 3

const KEY = 'logslate:default_range_months'
const DEFAULT: DefaultRangeMonths = 1

function isDefaultRangeMonths(v: unknown): v is DefaultRangeMonths {
  return v === 1 || v === 2 || v === 3
}

function load(): DefaultRangeMonths {
  try {
    const v = Number(localStorage.getItem(KEY))
    return isDefaultRangeMonths(v) ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

const listeners = new Set<() => void>()

export function setDefaultRangeMonths(months: DefaultRangeMonths): void {
  const prev = load()
  if (months === prev) return
  try {
    localStorage.setItem(KEY, String(months))
  } catch {
    // localStorage unavailable — in-memory state still works for this session.
  }
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useDefaultRangeMonths(): DefaultRangeMonths {
  return useSyncExternalStore(subscribe, load, () => DEFAULT)
}
