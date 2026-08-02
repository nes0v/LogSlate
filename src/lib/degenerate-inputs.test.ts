import { describe, it, expect } from 'vitest'
import {
  profitFactor, payoffRatio, expectancyR, expectancyDollars, sqn,
  streakStats, drawdownStats, ratioStats, rDistribution, maeMfeStats,
  extremeStats,
} from './advanced-stats'
import { aggregate, computeCandles, adjustmentsByDate } from './trade-stats'
import { bucketByTimeframe } from './buckets'
import { tradeMetrics, computeNetPnl, computeDuration, inferSide } from './trade-math'
import { tradeRecord } from '@/test/fixtures'

// Inputs the UI can produce but the happy path never exercises: an account
// with nothing in it, a half-logged trade, a hand-edited URL. Each of these
// reaches the compute layer, and a NaN or a reversed series there surfaces as
// a confidently wrong number rather than an error.

const EMPTY: never[] = []

describe('degenerate inputs — empty collections', () => {
  it('every aggregate returns null rather than NaN for no trades', () => {
    expect(profitFactor(EMPTY)).toBeNull()
    expect(payoffRatio(EMPTY)).toBeNull()
    expect(expectancyR(EMPTY)).toBeNull()
    expect(expectancyDollars(EMPTY)).toBeNull()
    expect(sqn(EMPTY)).toBeNull()
  })

  it('aggregate() produces only finite numbers for no trades', () => {
    const a = aggregate(EMPTY)
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === 'number') expect(Number.isFinite(v), `${k} = ${v}`).toBe(true)
    }
  })

  it('shape-producing helpers survive empty input', () => {
    expect(() => streakStats(EMPTY)).not.toThrow()
    expect(() => rDistribution(EMPTY)).not.toThrow()
    expect(() => maeMfeStats(EMPTY)).not.toThrow()
    expect(() => extremeStats(EMPTY)).not.toThrow()
    expect(() => drawdownStats([], 0)).not.toThrow()
    expect(() => ratioStats([])).not.toThrow()
    expect(() => computeCandles([])).not.toThrow()
    expect(adjustmentsByDate([]).size).toBe(0)
  })
})

describe('degenerate inputs — half-logged trades', () => {
  const noTimes = tradeRecord({
    executions: [
      { kind: 'buy', order_type: 'mkt', price: 100, time: 'not-a-date', contracts: 1 },
      { kind: 'sell', order_type: 'mkt', price: 110, time: 'not-a-date', contracts: 1 },
    ],
  })
  const zeroStop = tradeRecord({ stop_loss: 0 })
  const openTrade = tradeRecord({
    executions: [
      { kind: 'buy', order_type: 'mkt', price: 100, time: '2026-06-01T13:00:00.000Z', contracts: 1 },
    ],
  })

  it('unparseable execution times yield null, never NaN', () => {
    expect(computeDuration(noTimes).total_ms).toBeNull()
    expect(Number.isFinite(aggregate([noTimes]).net_pnl)).toBe(true)
  })

  it('a zero stop loss is skipped instead of dividing by zero', () => {
    expect(expectancyR([zeroStop])).toBeNull()
    expect(sqn([zeroStop])).toBeNull()
    const a = aggregate([zeroStop])
    expect(a.avg_realized_rr === null || Number.isFinite(a.avg_realized_rr)).toBe(true)
  })

  it('an open (one-sided) trade has no PNL rather than a wrong one', () => {
    expect(computeNetPnl(openTrade)).toBeNull()
    expect(inferSide(openTrade)).toBe('long')
    expect(tradeMetrics(openTrade).outcome).toBe('scratch')
  })

  it('profit factor is Infinity when nothing lost — formatters must cope', () => {
    const win = tradeRecord({
      executions: [
        { kind: 'buy', order_type: 'mkt', price: 100, time: '2026-06-01T13:00:00.000Z', contracts: 1 },
        { kind: 'sell', order_type: 'mkt', price: 200, time: '2026-06-01T14:00:00.000Z', contracts: 1 },
      ],
    })
    expect(profitFactor([win])).toBe(Infinity)
  })
})

describe('degenerate inputs — inverted date range', () => {
  // `?from=2026-06-10&to=2026-06-01` passes `filtersFromParams`, which checks
  // each bound's shape but not their order. date-fns walks such an interval
  // backwards instead of rejecting it, so without a guard the equity curve
  // renders right-to-left.
  it('produces no buckets at any timeframe', () => {
    for (const tf of ['D', 'W', 'M', 'Q', 'Y'] as const) {
      expect(
        bucketByTimeframe(tf, [], new Date('2026-06-10'), new Date('2026-06-01')),
        `timeframe ${tf}`,
      ).toEqual([])
    }
  })
})
