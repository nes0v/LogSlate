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

  it('averages win and loss PnL separately (breakevens excluded)', () => {
    // winner: +$195.5 net, loser: -$204.5 net
    const trades = [winningTrade(), winningTrade(), losingTrade(), breakevenTrade()]
    const s = aggregate(trades)
    expect(s.avg_win).toBeCloseTo(195.5, 5)
    expect(s.avg_loss).toBeCloseTo(-204.5, 5)
  })

  it('returns null averages when no wins or losses exist', () => {
    expect(aggregate([breakevenTrade()]).avg_win).toBeNull()
    expect(aggregate([breakevenTrade()]).avg_loss).toBeNull()
    expect(aggregate([winningTrade()]).avg_loss).toBeNull()
    expect(aggregate([losingTrade()]).avg_win).toBeNull()
  })

  it('averages total duration across trades with timing data', () => {
    const t1 = tradeRecord({
      executions: [
        execution({ kind: 'buy', time: '2026-04-20T10:00:00Z' }),
        execution({ kind: 'sell', time: '2026-04-20T10:10:00Z' }),
      ],
    })
    const t2 = tradeRecord({
      executions: [
        execution({ kind: 'buy', time: '2026-04-20T11:00:00Z' }),
        execution({ kind: 'sell', time: '2026-04-20T11:30:00Z' }),
      ],
    })
    const s = aggregate([t1, t2])
    // avg of 10min and 30min = 20min = 1_200_000 ms
    expect(s.avg_duration_ms).toBe(1_200_000)
  })

  it('ignores trades with unparseable timing when averaging duration', () => {
    const t = tradeRecord({
      executions: [execution({ kind: 'buy', time: 'not-a-date' })],
    })
    expect(aggregate([t]).avg_duration_ms).toBeNull()
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

  it('adjustment does not affect the bucket candle itself', () => {
    // Day with just a deposit: open=close=0 (no trades), adjustment is recorded.
    const day1 = bucketWith([], '2026-04-01')
    const adjMap = new Map<string, number>([['2026-04-01', 1000]])
    const [c] = computeCandles([day1], adjMap)
    expect(c.adjustment).toBe(1000)
    expect(c.open).toBe(0)
    expect(c.close).toBe(0)
    expect(c.high).toBe(0)
    expect(c.low).toBe(0)
  })

  it('adjustment shifts only the next bucket, not the current one', () => {
    // A winning trade closes at +195.5; a $500 deposit lands that same day.
    // The candle shows trading only (+195.5); next day opens at 695.5.
    const day1 = bucketWith([winningTrade()], '2026-04-01')
    const day2 = bucketWith([winningTrade()], '2026-04-02')
    const adjMap = new Map<string, number>([['2026-04-01', 500]])
    const [c1, c2] = computeCandles([day1, day2], adjMap)
    expect(c1.close).toBeCloseTo(195.5, 5)
    expect(c1.high).toBeCloseTo(195.5, 5)
    expect(c2.open).toBeCloseTo(695.5, 5)
    expect(c2.close).toBeCloseTo(695.5 + 195.5, 5)
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

    // Day 1: trades only
    expect(candles[0].close).toBeCloseTo(391, 5)
    // Day 2 (withdraw-only): candle unchanged (open=close=previous close);
    // running drops for the next bucket.
    expect(candles[1].open).toBeCloseTo(391, 5)
    expect(candles[1].close).toBeCloseTo(391, 5)
    // Subsequent days open at the post-withdraw baseline
    expect(candles[2].open).toBeCloseTo(-209, 5)
    expect(candles[2].close).toBeCloseTo(-13.5, 5)
    expect(candles[3].open).toBeCloseTo(-13.5, 5)
    expect(candles[3].close).toBeCloseTo(182, 5)
  })

  it('negative adjustments (withdraw) lower equity for the next bucket', () => {
    const day1 = bucketWith([], '2026-04-01')
    const day2 = bucketWith([], '2026-04-02')
    const adjMap = new Map<string, number>([['2026-04-01', -300]])
    const [c1, c2] = computeCandles([day1, day2], adjMap)
    expect(c1.close).toBe(0) // current bucket unchanged
    expect(c2.open).toBe(-300) // next bucket opens at the new baseline
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
