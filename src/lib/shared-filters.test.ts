import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, type TradeFilters } from './filters'
import {
  defaultRange,
  hasAnyFilter,
  loadSharedFilters,
  saveSharedFilters,
} from './shared-filters'

const KEY = 'logslate.shared-filters.v1'

afterEach(() => {
  localStorage.removeItem(KEY)
})

describe('defaultRange', () => {
  it('returns a one-month inclusive window ending on baseDate', () => {
    expect(defaultRange('2026-06-08')).toEqual({
      from: '2026-05-08',
      to: '2026-06-08',
    })
  })

  it('clamps when the prior month is shorter', () => {
    expect(defaultRange('2026-03-31')).toEqual({
      from: '2026-02-28',
      to: '2026-03-31',
    })
  })

  it('clamps to Feb 29 in a leap year', () => {
    expect(defaultRange('2028-03-30')).toEqual({
      from: '2028-02-29',
      to: '2028-03-30',
    })
  })

  it('crosses the year boundary', () => {
    expect(defaultRange('2026-01-15')).toEqual({
      from: '2025-12-15',
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
      { symbol: 'NQ' },
      { contract: 'micro' },
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
      symbol: 'NQ',
      contract: 'micro',
      session: 'am',
      rating: 'excellent',
    }
    saveSharedFilters(f)
    expect(loadSharedFilters()).toEqual(f)
  })

  it('clears storage when given null', () => {
    saveSharedFilters({ ...EMPTY_FILTERS, symbol: 'NQ' })
    expect(loadSharedFilters()).not.toBeNull()
    saveSharedFilters(null)
    expect(loadSharedFilters()).toBeNull()
  })

  it('returns null when the stored value is malformed', () => {
    localStorage.setItem(KEY, 'not-json')
    expect(loadSharedFilters()).toBeNull()
  })
})
