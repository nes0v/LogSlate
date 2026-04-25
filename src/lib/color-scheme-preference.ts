// Win/loss color pair, persisted to localStorage and applied to the
// `--color-win` / `--color-loss` CSS variables at the `:root` level so
// every consumer (charts, tiles, badges) stays in sync.
//
// Single global preference (per device, not per account) — it's a
// visual preference, not data scoped to a trading account.

import { useSyncExternalStore } from 'react'

export type ColorScheme = 'classic' | 'azure'

export const COLOR_SCHEMES: Record<ColorScheme, { win: string; loss: string; label: string }> = {
  classic: { win: '#22c55e', loss: '#ef4444', label: 'Green / Red' },
  azure: { win: '#2563eb', loss: '#f59e0b', label: 'Blue / Orange' },
}

const KEY = 'logslate:color_scheme'
const DEFAULT: ColorScheme = 'classic'

function isColorScheme(v: unknown): v is ColorScheme {
  return v === 'classic' || v === 'azure'
}

function load(): ColorScheme {
  try {
    const v = localStorage.getItem(KEY)
    return isColorScheme(v) ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

const listeners = new Set<() => void>()

export function getColorScheme(): ColorScheme {
  return load()
}

/** Writes the win/loss pair from `scheme` onto `:root` so existing
 *  CSS-variable consumers (`text-(--color-win)`, `themeColor()`, etc.)
 *  pick up the change without code changes. */
export function applyColorScheme(scheme: ColorScheme): void {
  const colors = COLOR_SCHEMES[scheme]
  const root = document.documentElement
  root.style.setProperty('--color-win', colors.win)
  root.style.setProperty('--color-loss', colors.loss)
}

export function setColorScheme(scheme: ColorScheme): void {
  const prev = load()
  if (scheme === prev) return
  try {
    localStorage.setItem(KEY, scheme)
  } catch {
    // localStorage unavailable — in-memory state still works.
  }
  applyColorScheme(scheme)
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Reactive read for components that need to re-render on scheme change. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, load, () => DEFAULT)
}
