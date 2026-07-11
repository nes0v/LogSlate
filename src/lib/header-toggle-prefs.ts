import { loadJsonFromStorage, saveJsonToStorage } from '@/lib/storage'
import {
  includeOverridesFromParams,
  includeScratchesFromParams,
  OVERRIDES_PARAM,
  SCRATCHES_PARAM,
} from '@/lib/filters'

// The two Overview/Reports header toggles ("Show override days" / "Show scratch
// trades") persist across page navigation — and restarts — the same way the
// shared date/attribute filters do. The URL param, when present, is the source
// of truth for the current view; when it's absent (e.g. arriving via a nav
// link) the intent falls back to this store. Both default to on; only the
// "off" state is meaningful.
const KEY = 'logslate.header-toggles.v1'

export interface HeaderTogglePrefs {
  includeOverrides: boolean
  includeScratches: boolean
}

const DEFAULTS: HeaderTogglePrefs = { includeOverrides: true, includeScratches: true }

export function loadHeaderToggles(): HeaderTogglePrefs {
  return loadJsonFromStorage<HeaderTogglePrefs>(
    KEY,
    raw => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      // Default each field to on unless explicitly stored false.
      return {
        includeOverrides: r.includeOverrides !== false,
        includeScratches: r.includeScratches !== false,
      }
    },
    DEFAULTS,
  )
}

/** Merge-update one or both intents (the two toggles are set independently). */
export function saveHeaderToggles(patch: Partial<HeaderTogglePrefs>): void {
  saveJsonToStorage(KEY, { ...loadHeaderToggles(), ...patch })
}

// Effective intent for a render: the URL param wins when present, otherwise the
// persisted store. Read synchronously on render so the toggle and the stats
// never flash their default for a frame before a hydration effect catches up.
export function includeOverridesIntent(params: URLSearchParams): boolean {
  return params.has(OVERRIDES_PARAM)
    ? includeOverridesFromParams(params)
    : loadHeaderToggles().includeOverrides
}
export function includeScratchesIntent(params: URLSearchParams): boolean {
  return params.has(SCRATCHES_PARAM)
    ? includeScratchesFromParams(params)
    : loadHeaderToggles().includeScratches
}

/** Write the stored "off" intents onto a params set that omits them — used by
 *  the hydration effect so the URL reflects the persisted state (which also
 *  makes turning a toggle back on a real param change, hence reactive). */
export function hydrateHeaderToggleParams(params: URLSearchParams): boolean {
  const t = loadHeaderToggles()
  let changed = false
  if (!params.has(OVERRIDES_PARAM) && !t.includeOverrides) {
    params.set(OVERRIDES_PARAM, '0')
    changed = true
  }
  if (!params.has(SCRATCHES_PARAM) && !t.includeScratches) {
    params.set(SCRATCHES_PARAM, '0')
    changed = true
  }
  return changed
}
