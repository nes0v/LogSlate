import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  applyFilters,
  filtersFromParams,
  hasAnyFilter,
  paramsFromFilters,
} from './filters'
import { tradeRecord } from '@/test/fixtures'

describe('hasAnyFilter', () => {
  it('is false for the empty object', () => {
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false)
  })

  it('is true when any single field is set', () => {
    expect(hasAnyFilter({ ...EMPTY_FILTERS, symbol: 'NQ' })).toBe(true)
    expect(hasAnyFilter({ ...EMPTY_FILTERS, from: '2026-04-01' })).toBe(true)
  })
})

describe('applyFilters', () => {
  const trades = [
    tradeRecord({ trade_date: '2026-04-05', symbol: 'NQ', contract_type: 'mini', session: 'AM', rating: 'good' }),
    tradeRecord({ trade_date: '2026-04-10', symbol: 'ES', contract_type: 'micro', session: 'PM', rating: 'egg' }),
    tradeRecord({ trade_date: '2026-04-20', symbol: 'NQ', contract_type: 'micro', session: 'LT', rating: 'excellent' }),
  ]

  it('filters by date range inclusively', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, from: '2026-04-06', to: '2026-04-15' })
    expect(out).toHaveLength(1)
    expect(out[0].trade_date).toBe('2026-04-10')
  })

  it('filters by symbol', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, symbol: 'NQ' })
    expect(out).toHaveLength(2)
    expect(out.every(t => t.symbol === 'NQ')).toBe(true)
  })

  it('filters by contract type', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, contract: 'micro' })
    expect(out).toHaveLength(2)
  })

  it('filters by session', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, session: 'AM' })
    expect(out).toHaveLength(1)
  })

  it('filters by rating', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, rating: 'excellent' })
    expect(out).toHaveLength(1)
  })

  it('combines multiple filters', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, symbol: 'NQ', contract: 'micro' })
    expect(out).toHaveLength(1)
    expect(out[0].trade_date).toBe('2026-04-20')
  })

  it('returns all trades for the empty filter', () => {
    expect(applyFilters(trades, EMPTY_FILTERS)).toHaveLength(3)
  })
})

describe('filtersFromParams ↔ paramsFromFilters round-trip', () => {
  it('round-trips a fully-set filter', () => {
    const filters = {
      from: '2026-04-01',
      to: '2026-04-30',
      symbol: 'NQ' as const,
      contract: 'mini' as const,
      session: 'AM' as const,
      rating: 'good' as const,
    }
    expect(filtersFromParams(paramsFromFilters(filters))).toEqual(filters)
  })

  it('empties filters produce an empty query string', () => {
    expect(paramsFromFilters(EMPTY_FILTERS).toString()).toBe('')
  })

  it('rejects unknown enum values', () => {
    const p = new URLSearchParams('symbol=XX&contract=huge&session=foo&rating=bad')
    const f = filtersFromParams(p)
    expect(f.symbol).toBeNull()
    expect(f.contract).toBeNull()
    expect(f.session).toBeNull()
    expect(f.rating).toBeNull()
  })

  it('preserves free-form date strings', () => {
    const p = new URLSearchParams('from=2026-04-01&to=2026-04-30')
    const f = filtersFromParams(p)
    expect(f.from).toBe('2026-04-01')
    expect(f.to).toBe('2026-04-30')
  })
})
