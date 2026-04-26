// Light / dark theme preference, persisted to localStorage and applied via
// `data-theme` on the document root. The CSS in `src/index.css` consumes
// this through `light-dark()` plus a `[data-theme="…"]` override that locks
// `color-scheme` to a specific mode.
//
// `system` removes the attribute entirely so the browser follows the OS
// preference automatically (and reacts live when the OS toggles). The
// dark/light values force one mode regardless of OS.
//
// Single global preference (per device) — like `color-scheme-preference.ts`.

import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export const THEME_OPTIONS: ThemePreference[] = ['system', 'light', 'dark']

const KEY = 'logslate:theme'
const DEFAULT: ThemePreference = 'system'

function isTheme(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark'
}

function load(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return isTheme(v) ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

const listeners = new Set<() => void>()

export function getTheme(): ThemePreference {
  return load()
}

/** Resolves to either 'light' or 'dark' — what the user actually sees. */
export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/**
 * Apply the preference to the document root. `system` removes the attribute
 * so the browser picks based on OS preference; `light`/`dark` lock it.
 *
 * Also keeps the <meta name="theme-color"> in sync so installed PWAs get the
 * right status-bar tint.
 */
export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement
  if (pref === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', pref)
  }
  // Update <meta name="theme-color"> to match the actual rendered bg.
  const resolved = resolveTheme(pref)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', resolved === 'light' ? '#e3e5ec' : '#0f1117')
  }
}

export function setTheme(pref: ThemePreference): void {
  const prev = load()
  if (prev === pref) return
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    // localStorage unavailable — in-memory state still works for this tab.
  }
  applyTheme(pref)
  listeners.forEach(fn => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  // Also re-render when the OS preference flips while we're on `system`.
  let mql: MediaQueryList | null = null
  if (typeof window !== 'undefined' && window.matchMedia) {
    mql = window.matchMedia('(prefers-color-scheme: light)')
    mql.addEventListener('change', fn)
  }
  return () => {
    listeners.delete(fn)
    mql?.removeEventListener('change', fn)
  }
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, load, () => DEFAULT)
}

/** Resolved value (always 'light' or 'dark'), reactive to OS changes too. */
export function useResolvedTheme(): 'light' | 'dark' {
  const pref = useThemePreference()
  return resolveTheme(pref)
}
