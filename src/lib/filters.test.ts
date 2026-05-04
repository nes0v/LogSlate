import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  MODEL_NONE,
  applyFilters,
  filtersFromParams,
  holdBucketOf,
  paramsFromFilters,
} from './filters'
import { tradeRecord } from '@/test/fixtures'

describe('applyFilters', () => {
  const trades = [
    tradeRecord({ date: '2026-04-05', symbol: 'NQ', contract_type: 'mini', session: 'am', rating: 'good' }),
    tradeRecord({ date: '2026-04-10', symbol: 'ES', contract_type: 'micro', session: 'pm', rating: 'poor' }),
    tradeRecord({ date: '2026-04-20', symbol: 'NQ', contract_type: 'micro', session: 'lunch', rating: 'excellent' }),
  ]

  it('filters by date range inclusively', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, from: '2026-04-06', to: '2026-04-15' })
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-04-10')
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
    const out = applyFilters(trades, { ...EMPTY_FILTERS, session: 'am' })
    expect(out).toHaveLength(1)
  })

  it('filters by rating', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, rating: 'excellent' })
    expect(out).toHaveLength(1)
  })

  it('combines multiple filters', () => {
    const out = applyFilters(trades, { ...EMPTY_FILTERS, symbol: 'NQ', contract: 'micro' })
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-04-20')
  })

  it('returns all trades for the empty filter', () => {
    expect(applyFilters(trades, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filters by weekday (using local-day arithmetic on the trade date)', () => {
    // 2026-04-05 is Sun, 04-10 is Fri, 04-20 is Mon.
    const out = applyFilters(trades, { ...EMPTY_FILTERS, weekday: 'mon' })
    expect(out.map(t => t.date)).toEqual(['2026-04-20'])
  })

  it('filters by side (long vs short)', () => {
    const longTrade = tradeRecord({
      executions: [
        { kind: 'buy', price: 100, time: '2026-04-05T13:30:00.000Z', contracts: 1 },
        { kind: 'sell', price: 105, time: '2026-04-05T14:00:00.000Z', contracts: 1 },
      ],
    })
    const shortTrade = tradeRecord({
      executions: [
        { kind: 'sell', price: 100, time: '2026-04-05T13:30:00.000Z', contracts: 1 },
        { kind: 'buy', price: 95, time: '2026-04-05T14:00:00.000Z', contracts: 1 },
      ],
    })
    const all = [longTrade, shortTrade]
    expect(applyFilters(all, { ...EMPTY_FILTERS, side: 'long' })).toEqual([longTrade])
    expect(applyFilters(all, { ...EMPTY_FILTERS, side: 'short' })).toEqual([shortTrade])
  })

  it('filters by model id, with MODEL_NONE matching trades that have no model', () => {
    const withModel = tradeRecord({ model_id: 'abc-1' })
    const noModel = tradeRecord({ model_id: null })
    const all = [withModel, noModel]
    expect(applyFilters(all, { ...EMPTY_FILTERS, model: 'abc-1' })).toEqual([withModel])
    expect(applyFilters(all, { ...EMPTY_FILTERS, model: MODEL_NONE })).toEqual([noModel])
  })
})

describe('holdBucketOf', () => {
  it('returns null when there are fewer than two timestamps', () => {
    const t = tradeRecord({
      executions: [{ kind: 'buy', price: 100, time: '2026-04-05T13:30:00.000Z', contracts: 1 }],
    })
    expect(holdBucketOf(t)).toBeNull()
  })

  it('classifies into the right bucket by minutes', () => {
    const t = tradeRecord({
      executions: [
        { kind: 'buy', price: 100, time: '2026-04-05T13:30:00.000Z', contracts: 1 },
        { kind: 'sell', price: 105, time: '2026-04-05T13:33:00.000Z', contracts: 1 },
      ],
    })
    expect(holdBucketOf(t)).toBe('1-5m')
  })
})

describe('filtersFromParams ↔ paramsFromFilters round-trip', () => {
  it('round-trips a fully-set filter', () => {
    const filters = {
      ...EMPTY_FILTERS,
      from: '2026-04-01',
      to: '2026-04-30',
      symbol: 'NQ' as const,
      contract: 'mini' as const,
      session: 'am' as const,
      rating: 'good' as const,
      weekday: 'mon' as const,
      outcome: 'win' as const,
      side: 'long' as const,
      hold: '5-15m' as const,
      emotion: 'calm' as const,
      model: 'abc-123',
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

describe('applyFilters — newer filter dimensions', () => {
  // Trades engineered to cover each new dimension. tradeRecord defaults set
  // a clear winner profile (long, hold ~5min, NQ mini, am session, focused
  // emotion, no model). Overrides flip individual axes.

  function buys(price: number, time: string) {
    return { kind: 'buy' as const, price, time, contracts: 1 }
  }
  function sells(price: number, time: string) {
    return { kind: 'sell' as const, price, time, contracts: 1 }
  }

  it('outcome filter picks per classifyTrade', () => {
    // Big-handle wins/losses on NQ mini ($50/handle, 5-handle scratch band).
    const winT = tradeRecord({
      executions: [
        buys(20000, '2026-04-15T14:00:00.000Z'),
        sells(20100, '2026-04-15T14:30:00.000Z'),
      ],
    })
    const lossT = tradeRecord({
      executions: [
        buys(20100, '2026-04-15T14:00:00.000Z'),
        sells(20000, '2026-04-15T14:30:00.000Z'),
      ],
    })
    const all = [winT, lossT]
    expect(applyFilters(all, { ...EMPTY_FILTERS, outcome: 'win' })).toEqual([winT])
    expect(applyFilters(all, { ...EMPTY_FILTERS, outcome: 'loss' })).toEqual([lossT])
  })

  it('emotion filter matches exact value', () => {
    const calm = tradeRecord({ emotion: 'calm' })
    const fomo = tradeRecord({ emotion: 'FOMO' })
    expect(
      applyFilters([calm, fomo], { ...EMPTY_FILTERS, emotion: 'calm' }),
    ).toEqual([calm])
  })

  it('hold filter matches the bucket of first→last span', () => {
    const short = tradeRecord({
      executions: [
        buys(100, '2026-04-15T14:00:00.000Z'),
        sells(101, '2026-04-15T14:03:00.000Z'),
      ],
    })
    const long = tradeRecord({
      executions: [
        buys(100, '2026-04-15T14:00:00.000Z'),
        sells(101, '2026-04-15T15:30:00.000Z'),
      ],
    })
    expect(
      applyFilters([short, long], { ...EMPTY_FILTERS, hold: '1-5m' }),
    ).toEqual([short])
    expect(
      applyFilters([short, long], { ...EMPTY_FILTERS, hold: '1-2h' }),
    ).toEqual([long])
  })
})

describe('filtersFromParams — rejects garbage on every enum', () => {
  it('treats unknown values for new dimensions as null', () => {
    const p = new URLSearchParams(
      'weekday=funday&outcome=meh&side=sideways&hold=forever&emotion=ennui',
    )
    const f = filtersFromParams(p)
    expect(f.weekday).toBeNull()
    expect(f.outcome).toBeNull()
    expect(f.side).toBeNull()
    expect(f.hold).toBeNull()
    expect(f.emotion).toBeNull()
  })
})
