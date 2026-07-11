import { beforeEach, describe, expect, it } from 'vitest'
import {
  hydrateHeaderToggleParams,
  includeOverridesIntent,
  includeScratchesIntent,
  loadHeaderToggles,
  saveHeaderToggles,
} from '@/lib/header-toggle-prefs'

beforeEach(() => localStorage.clear())

describe('header-toggle-prefs', () => {
  it('defaults both toggles to on when nothing is stored', () => {
    expect(loadHeaderToggles()).toEqual({ includeOverrides: true, includeScratches: true })
  })

  it('merge-updates one intent without clobbering the other', () => {
    saveHeaderToggles({ includeScratches: false })
    expect(loadHeaderToggles()).toEqual({ includeOverrides: true, includeScratches: false })
    saveHeaderToggles({ includeOverrides: false })
    expect(loadHeaderToggles()).toEqual({ includeOverrides: false, includeScratches: false })
  })

  it('URL param wins over the store when present', () => {
    saveHeaderToggles({ includeScratches: false, includeOverrides: false })
    // Param says on -> on, even though the store says off.
    expect(includeScratchesIntent(new URLSearchParams('scratches=1'))).toBe(true)
    expect(includeOverridesIntent(new URLSearchParams('overrides=1'))).toBe(true)
    // Param says off -> off.
    expect(includeScratchesIntent(new URLSearchParams('scratches=0'))).toBe(false)
  })

  it('falls back to the store when the URL omits the param', () => {
    saveHeaderToggles({ includeScratches: false })
    expect(includeScratchesIntent(new URLSearchParams(''))).toBe(false)
    expect(includeOverridesIntent(new URLSearchParams(''))).toBe(true)
  })

  it('hydrates only the omitted, stored-off params', () => {
    saveHeaderToggles({ includeScratches: false, includeOverrides: true })
    const p = new URLSearchParams('from=2026-01-01')
    const changed = hydrateHeaderToggleParams(p)
    expect(changed).toBe(true)
    expect(p.get('scratches')).toBe('0')
    expect(p.has('overrides')).toBe(false) // stored on -> not written
    // Nothing to do when the param is already present.
    expect(hydrateHeaderToggleParams(new URLSearchParams('scratches=0'))).toBe(false)
  })
})
