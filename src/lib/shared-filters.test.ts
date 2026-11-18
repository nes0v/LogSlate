import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, type TradeFilters } from './filters'
import {
  defaultRange,
  hasAnyFilter,
  loadSharedFilters,
  saveSharedFilters,
} from './shared-filters'

const KEY = 'logslate.shared-filters.v2'

afterEach(() => {
  localStorage.removeItem(KEY)
})

describe('defaultRange', () => {
  it('returns a four-week inclusive window ending on baseDate by default', () => {
    expect(defaultRange('2026-06-08')).toEqual({
      from: '2026-05-11',
      to: '2026-06-08',
    })
  })

  it('sizes the window in weeks', () => {
    expect(defaultRange('2026-06-08', 12)).toEqual({
      from: '2026-03-16',
      to: '2026-06-08',
    })
  })

  it('snaps both edges of a weekend baseDate to weekdays', () => {
    // Sat Jun 20 → from Sat May 23 → Mon May 25; to → Fri Jun 19.
    expect(defaultRange('2026-06-20')).toEqual({
      from: '2026-05-25',
      to: '2026-06-19',
    })
  })

  it('crosses the year boundary', () => {
    expect(defaultRange('2026-01-15')).toEqual({
      from: '2025-12-18',
      to: '2026-01-15',
    })
  })
})

describe('hasAnyFilter', () => {
  it('returns false for the empty filter', () => {
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false)
  })

  it('returns true for any non-null filter slot', () => {
    const cases: Array<Partial<TradeFilters>> = [
      { from: '2026-04-01' },
      { to: '2026-04-30' },
      { symbol_id: 'sym-nq' },
      { session: 'am' },
      { rating: 'excellent' },
    ]
    for (const patch of cases) {
      expect(hasAnyFilter({ ...EMPTY_FILTERS, ...patch })).toBe(true)
    }
  })
})

describe('saveSharedFilters / loadSharedFilters', () => {
  it('returns null when nothing is stored', () => {
    expect(loadSharedFilters()).toBeNull()
  })

  it('round-trips a populated filter', () => {
    const f: TradeFilters = {
      ...EMPTY_FILTERS,
      from: '2026-04-01',
      to: '2026-04-30',
      symbol_id: 'sym-nq',
      session: 'am',
      rating: 'excellent',
    }
    saveSharedFilters(f)
    expect(loadSharedFilters()).toEqual(f)
  })

  it('clears storage when given null', () => {
    saveSharedFilters({ ...EMPTY_FILTERS, symbol_id: 'sym-nq' })
    expect(loadSharedFilters()).not.toBeNull()
    saveSharedFilters(null)
    expect(loadSharedFilters()).toBeNull()
  })

  it('returns null when the stored value is malformed', () => {
    localStorage.setItem(KEY, 'not-json')
    expect(loadSharedFilters()).toBeNull()
  })
})
