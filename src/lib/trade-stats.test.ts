import { describe, expect, it } from 'vitest'
import {
  adjustmentsByDate,
  aggregate,
  computeCandles,
  signedAdjustment,
} from './trade-stats'
import type { Bucket } from '@/lib/buckets'
import { adjustmentRecord, execution, tradeRecord } from '@/test/fixtures'

function winningTrade() {
  return tradeRecord({
    symbol: 'NQ',
    contract_type: 'mini',
    executions: [
      execution({ kind: 'buy', price: 20000, contracts: 1 }),
      execution({ kind: 'sell', price: 20010, contracts: 1 }),
    ],
    stop_loss: 100,
    pnl_override: null,
    planned_rr: 2,
  })
}

function losingTrade() {
  return tradeRecord({
    symbol: 'NQ',
    contract_type: 'mini',
    executions: [
      execution({ kind: 'buy', price: 20000, contracts: 1 }),
      execution({ kind: 'sell', price: 19990, contracts: 1 }),
    ],
    stop_loss: 200,
    pnl_override: null,
    planned_rr: 3,
  })
}

function breakevenTrade() {
  return tradeRecord({ pnl_override: 0 })
}

describe('aggregate', () => {
  it('returns zeros for empty input', () => {
    const s = aggregate([])
    expect(s.count).toBe(0)
    expect(s.net_pnl).toBe(0)
    expect(s.wins).toBe(0)
    expect(s.losses).toBe(0)
    expect(s.win_rate).toBeNull()
    expect(s.best).toBeNull()
    expect(s.worst).toBeNull()
  })

  it('sums gross and fees and nets them', () => {
    const trades = [winningTrade(), losingTrade()]
    const s = aggregate(trades)
    // gross: +200 + (-200) = 0. fees: 4.5 + 4.5 = 9. net: -9
    expect(s.gross_pnl).toBeCloseTo(0, 5)
    expect(s.fees).toBeCloseTo(9, 5)
    expect(s.net_pnl).toBeCloseTo(-9, 5)
  })

  it('counts wins, losses, breakevens and computes win_rate', () => {
    const trades = [winningTrade(), winningTrade(), losingTrade(), breakevenTrade()]
    const s = aggregate(trades)
    expect(s.wins).toBe(2)
    expect(s.losses).toBe(1)
    expect(s.breakevens).toBe(1)
    expect(s.win_rate).toBeCloseTo(2 / 3, 5) // breakevens excluded from denominator
  })

  it('returns null win_rate when no decided outcomes', () => {
    const trades = [breakevenTrade(), breakevenTrade()]
    expect(aggregate(trades).win_rate).toBeNull()
  })

  it('tracks best and worst', () => {
    const trades = [winningTrade(), losingTrade()]
    const s = aggregate(trades)
    expect(s.best).toBeGreaterThan(0)
    expect(s.worst).toBeLessThan(0)
  })

  it('averages planned and realized R', () => {
    const trades = [winningTrade(), losingTrade()]
    const s = aggregate(trades)
    expect(s.avg_planned_rr).toBeCloseTo(2.5, 5)
    expect(s.avg_realized_rr).not.toBeNull()
  })
})

describe('signedAdjustment', () => {
  it('positive for deposit', () => {
    expect(signedAdjustment(adjustmentRecord({ kind: 'deposit', amount: 500 }))).toBe(500)
  })

  it('negative for withdraw', () => {
    expect(signedAdjustment(adjustmentRecord({ kind: 'withdraw', amount: 250 }))).toBe(-250)
  })
})

describe('adjustmentsByDate', () => {
  it('groups signed amounts by date', () => {
    const m = adjustmentsByDate([
      adjustmentRecord({ date: '2026-04-01', kind: 'deposit', amount: 1000 }),
      adjustmentRecord({ date: '2026-04-01', kind: 'withdraw', amount: 200 }),
      adjustmentRecord({ date: '2026-04-05', kind: 'deposit', amount: 500 }),
    ])
    expect(m.get('2026-04-01')).toBe(800)
    expect(m.get('2026-04-05')).toBe(500)
    expect(m.get('2026-04-02')).toBeUndefined()
  })
})

function bucketWith(trades: ReturnType<typeof tradeRecord>[], key: string): Bucket {
  return {
    key,
    label: key,
    rangeStart: key,
    rangeEnd: key,
    navTarget: `/day/${key}`,
    trades,
  }
}

describe('computeCandles', () => {
  it('each close chains into the next open', () => {
    const day1 = bucketWith([winningTrade()], '2026-04-01')
    const day2 = bucketWith([losingTrade()], '2026-04-02')
    const candles = computeCandles([day1, day2])

    expect(candles[0].open).toBe(0)
    expect(candles[0].close).toBeCloseTo(195.5, 5) // +200 - 4.5
    expect(candles[1].open).toBeCloseTo(195.5, 5)
    expect(candles[1].close).toBeCloseTo(195.5 - 204.5, 5) // -200 - 4.5
  })

  it('empty bucket produces a flat candle at the running equity', () => {
    const day1 = bucketWith([winningTrade()], '2026-04-01')
    const day2 = bucketWith([], '2026-04-02')
    const [, second] = computeCandles([day1, day2])
    expect(second.open).toBeCloseTo(195.5, 5)
    expect(second.close).toBeCloseTo(195.5, 5)
    expect(second.high).toBeCloseTo(195.5, 5)
    expect(second.low).toBeCloseTo(195.5, 5)
    expect(second.count).toBe(0)
  })

  it('applies adjustments at bucket close and affects close', () => {
    const day1 = bucketWith([], '2026-04-01')
    const adjMap = new Map<string, number>([['2026-04-01', 1000]])
    const [c] = computeCandles([day1], adjMap)
    expect(c.adjustment).toBe(1000)
    expect(c.open).toBe(0)
    expect(c.close).toBe(1000)
    expect(c.high).toBe(1000)
    expect(c.low).toBe(0)
  })

  it('adjustment posts after trades (end-of-day)', () => {
    // A winning trade closes at +195.5, then a $500 deposit lands on top.
    const day = bucketWith([winningTrade()], '2026-04-01')
    const adjMap = new Map<string, number>([['2026-04-01', 500]])
    const [c] = computeCandles([day], adjMap)
    expect(c.close).toBeCloseTo(195.5 + 500, 5)
    // High should reflect the post-adjustment peak, not an intermediate value.
    expect(c.high).toBeCloseTo(695.5, 5)
  })

  it('carries a withdraw forward to later days (subsequent candles open lower)', () => {
    // Day 1: 2 winning trades = +391
    // Day 2: withdraw -600 (no trades)
    // Day 3: 1 winning trade
    // Day 4: 1 winning trade
    const day1 = bucketWith([winningTrade(), winningTrade()], '2026-04-15')
    const day2 = bucketWith([], '2026-04-16')
    const day3 = bucketWith([winningTrade()], '2026-04-17')
    const day4 = bucketWith([winningTrade()], '2026-04-18')

    const adjMap = new Map<string, number>([['2026-04-16', -600]])
    const candles = computeCandles([day1, day2, day3, day4], adjMap)

    expect(candles[0].close).toBeCloseTo(391, 5)
    // Withdraw day: open carried from day1 close, drops by 600
    expect(candles[1].open).toBeCloseTo(391, 5)
    expect(candles[1].close).toBeCloseTo(-209, 5)
    // Subsequent days continue from the post-withdraw level
    expect(candles[2].open).toBeCloseTo(-209, 5)
    expect(candles[2].close).toBeCloseTo(-13.5, 5)
    expect(candles[3].open).toBeCloseTo(-13.5, 5)
    expect(candles[3].close).toBeCloseTo(182, 5)
  })

  it('negative adjustments (withdraw) lower equity', () => {
    const day1 = bucketWith([], '2026-04-01')
    const adjMap = new Map<string, number>([['2026-04-01', -300]])
    const [c] = computeCandles([day1], adjMap)
    expect(c.close).toBe(-300)
  })

  it('tracks high and low across trades within a bucket', () => {
    const up = winningTrade() // +$195.5 net
    const down = losingTrade() // -$204.5 net
    const day = bucketWith([up, down], '2026-04-01')
    const [c] = computeCandles([day])
    expect(c.high).toBeCloseTo(195.5, 5)
    expect(c.low).toBeLessThan(0)
  })
})
