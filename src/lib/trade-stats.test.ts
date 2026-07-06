import { describe, expect, it } from 'vitest'
import {
  adjustmentsByDate,
  aggregate,
  computeCandles,
  foldOverridesIntoStats,
  signedAdjustment,
} from './trade-stats'
import type { Bucket } from '@/lib/buckets'
import { adjustmentRecord, execution, symbolSnapshot, tradeRecord } from '@/test/fixtures'

function winningTrade() {
  return tradeRecord({
    symbol_spec: symbolSnapshot(),
    executions: [
      execution({ kind: 'buy', price: 20000, contracts: 1 }),
      execution({ kind: 'sell', price: 20010, contracts: 1 }),
    ],
    stop_loss: 100,
    profit_target: 200,
  })
}

function losingTrade() {
  return tradeRecord({
    symbol_spec: symbolSnapshot(),
    executions: [
      execution({ kind: 'buy', price: 20000, contracts: 1 }),
      execution({ kind: 'sell', price: 19990, contracts: 1 }),
    ],
    stop_loss: 200,
    profit_target: 600,
  })
}

// AHPC = 0 (buy/sell at same price) → classifyTrade returns 'scratch',
// and the net pnl is just −fees.
function scratchTrade() {
  return tradeRecord({
    symbol_spec: symbolSnapshot(),
    executions: [
      execution({ kind: 'buy', price: 20000, contracts: 1 }),
      execution({ kind: 'sell', price: 20000, contracts: 1 }),
    ],
  })
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

  it('counts wins, losses, scratches and computes win_rate', () => {
    const trades = [winningTrade(), winningTrade(), losingTrade(), scratchTrade()]
    const s = aggregate(trades)
    expect(s.wins).toBe(2)
    expect(s.losses).toBe(1)
    expect(s.scratches).toBe(1)
    expect(s.win_rate).toBeCloseTo(2 / 3, 5) // scratches excluded from denominator
  })

  it('returns null win_rate when no decided outcomes', () => {
    const trades = [scratchTrade(), scratchTrade()]
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

  it('averages win and loss PNL separately (scratches excluded)', () => {
    // winner: +$195.5 net, loser: -$204.5 net
    const trades = [winningTrade(), winningTrade(), losingTrade(), scratchTrade()]
    const s = aggregate(trades)
    expect(s.avg_win).toBeCloseTo(195.5, 5)
    expect(s.avg_loss).toBeCloseTo(-204.5, 5)
  })

  it('returns null averages when no wins or losses exist', () => {
    expect(aggregate([scratchTrade()]).avg_win).toBeNull()
    expect(aggregate([scratchTrade()]).avg_loss).toBeNull()
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

  it('averages stop_loss across trades that have one', () => {
    const trades = [
      tradeRecord({ stop_loss: 100 }),
      tradeRecord({ stop_loss: 200 }),
      tradeRecord({ stop_loss: 0 }), // ignored
    ]
    expect(aggregate(trades).avg_risk).toBeCloseTo(150, 5)
  })

  it('returns null avg_risk when no trade has a stop', () => {
    expect(aggregate([tradeRecord({ stop_loss: 0 })]).avg_risk).toBeNull()
  })
})

describe('signedAdjustment', () => {
  it('positive for deposit', () => {
    expect(signedAdjustment(adjustmentRecord({ kind: 'deposit', amount: 500 }))).toBe(500)
  })

  it('negative for withdraw', () => {
    expect(signedAdjustment(adjustmentRecord({ kind: 'withdraw', amount: 250 }))).toBe(-250)
  })

  it('negative for fee', () => {
    expect(signedAdjustment(adjustmentRecord({ kind: 'fee', amount: 15 }))).toBe(-15)
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

  it('folds a deposit into the bucket open so it never opens at zero', () => {
    // A $500 deposit lands in the bucket; the candle opens at the funded level
    // (500) and the win lifts it to 695.5 — not a span up from zero.
    const day1 = bucketWith([winningTrade()], '2026-04-01')
    const day2 = bucketWith([winningTrade()], '2026-04-02')
    const adjMap = new Map<string, number>([['2026-04-01', 500]])
    const [c1, c2] = computeCandles([day1, day2], adjMap)
    expect(c1.open).toBe(500)
    expect(c1.close).toBeCloseTo(695.5, 5)
    expect(c1.adjustment).toBe(500)
    expect(c2.open).toBeCloseTo(695.5, 5)
    expect(c2.close).toBeCloseTo(695.5 + 195.5, 5)
  })

  it('a deposit funds the baseline so a later loss cannot draw a sub-zero wick', () => {
    // The bug this fixes: a deposit in the same (wide) bucket as the losing
    // trade lifts the opening baseline, so the wick stays realistic.
    const day = bucketWith([losingTrade()], '2026-Q2') // loss = -204.5 net
    const adjMap = new Map<string, number>([['2026-Q2', 1000]])
    const [c] = computeCandles([day], adjMap)
    // open 1000 → close 1000 - 204.5 = 795.5; low never goes negative.
    expect(c.open).toBe(1000)
    expect(c.high).toBe(1000)
    expect(c.low).toBeCloseTo(795.5, 5)
    expect(c.close).toBeCloseTo(795.5, 5)
  })

  it('a withdraw lowers its own bucket open and every later bucket', () => {
    // Day 1: 2 winning trades = +391
    // Day 2: withdraw -600 (no trades) → opens AND closes at -209
    // Day 3 & 4: 1 winning trade each, opening at the post-withdraw baseline
    const day1 = bucketWith([winningTrade(), winningTrade()], '2026-04-15')
    const day2 = bucketWith([], '2026-04-16')
    const day3 = bucketWith([winningTrade()], '2026-04-17')
    const day4 = bucketWith([winningTrade()], '2026-04-18')

    const adjMap = new Map<string, number>([['2026-04-16', -600]])
    const candles = computeCandles([day1, day2, day3, day4], adjMap)

    expect(candles[0].close).toBeCloseTo(391, 5)
    // Day 2 (withdraw-only): the withdraw is folded into the open.
    expect(candles[1].open).toBeCloseTo(-209, 5)
    expect(candles[1].close).toBeCloseTo(-209, 5)
    expect(candles[2].open).toBeCloseTo(-209, 5)
    expect(candles[2].close).toBeCloseTo(-13.5, 5)
    expect(candles[3].open).toBeCloseTo(-13.5, 5)
    expect(candles[3].close).toBeCloseTo(182, 5)
  })

  it('negative adjustments (withdraw) lower equity from their bucket on', () => {
    const day1 = bucketWith([], '2026-04-01')
    const day2 = bucketWith([], '2026-04-02')
    const adjMap = new Map<string, number>([['2026-04-01', -300]])
    const [c1, c2] = computeCandles([day1, day2], adjMap)
    expect(c1.open).toBe(-300) // the withdraw is folded into this bucket's open
    expect(c1.close).toBe(-300)
    expect(c2.open).toBe(-300) // next bucket opens at the new baseline
  })

  it('folds a multi-day bucket’s cash flow into the open, not the body', () => {
    // A mid-week deposit must NOT inflate the weekly candle body: the body
    // (close − open) stays trading-only, and the deposit shifts the open/
    // baseline instead. (A trade-off vs. exact daily reconciliation: the
    // deposit lifts the whole week's baseline rather than landing mid-week.)
    const on = (date: string, t: ReturnType<typeof tradeRecord>) => ({ ...t, date })
    const weekTrades = [
      on('2026-04-13', winningTrade()), // +195.5
      on('2026-04-15', losingTrade()), // -204.5
      on('2026-04-15', losingTrade()), // -204.5
      on('2026-04-17', winningTrade()), // +195.5
    ]
    const tradeSum = 195.5 - 204.5 - 204.5 + 195.5 // -18
    const adjMap = new Map<string, number>([['2026-04-15', 500]])
    const startEquity = 1000

    const weekBucket: Bucket = {
      key: '2026-04-13',
      label: '2026-04-13',
      rangeStart: '2026-04-13',
      rangeEnd: '2026-04-19',
      navTarget: '/month/2026-04',
      trades: weekTrades,
    }
    const [week] = computeCandles([weekBucket], adjMap, startEquity)

    // Deposit folded into the open; body excludes it.
    expect(week.open).toBeCloseTo(startEquity + 500, 5)
    expect(week.close - week.open).toBeCloseTo(tradeSum, 5)
    expect(week.adjustment).toBe(500)
    expect(week.count).toBe(4)
  })

  it('tracks high and low across trades within a bucket', () => {
    const up = winningTrade() // +$195.5 net
    const down = losingTrade() // -$204.5 net
    const day = bucketWith([up, down], '2026-04-01')
    const [c] = computeCandles([day])
    expect(c.high).toBeCloseTo(195.5, 5)
    expect(c.low).toBeLessThan(0)
  })

  it('an override day steps by its net and counts its informational fees', () => {
    // The override replaces the day's trades with a single net step; its fees
    // never move equity (the net is already net of fees) but DO count toward
    // the bucket's fees pane so it isn't blind to override days.
    const day = bucketWith([], '2026-04-01')
    const overrides = new Map<string, number>([['2026-04-01', 300]])
    const feeOverrides = new Map<string, number>([['2026-04-01', 80]])
    const [c] = computeCandles([day], new Map(), 0, overrides, feeOverrides)
    expect(c.close).toBeCloseTo(300, 5) // equity steps by the net only
    expect(c.fees).toBeCloseTo(80, 5) // fees pane picks up the override's fees
    expect(c.isOverride).toBe(true)
  })
})

describe('foldOverridesIntoStats', () => {
  it('adds an override-only day to net + fees but leaves population fields', () => {
    const t = { ...winningTrade(), date: '2026-04-10' }
    const base = aggregate([t])
    const folded = foldOverridesIntoStats(
      base,
      [t],
      new Map([['2026-04-13', 500]]),
      new Map([['2026-04-13', 4.5]]),
      null,
      null,
    )
    expect(folded.net_pnl).toBeCloseTo(base.net_pnl + 500)
    expect(folded.fees).toBeCloseTo(base.fees + 4.5)
    // An override day isn't a win/loss — the population stats are untouched.
    expect(folded.wins).toBe(base.wins)
    expect(folded.losses).toBe(base.losses)
    expect(folded.win_rate).toBe(base.win_rate)
  })

  it('replaces a traded day’s net with the override value', () => {
    const t = { ...winningTrade(), date: '2026-04-13' }
    const base = aggregate([t])
    const folded = foldOverridesIntoStats(base, [t], new Map([['2026-04-13', -999]]), new Map(), null, null)
    expect(folded.net_pnl).toBe(-999)
  })

  it('ignores overrides outside the [from, to] window', () => {
    const base = aggregate([])
    const folded = foldOverridesIntoStats(
      base,
      [],
      new Map([['2026-04-13', 500]]),
      new Map(),
      '2026-04-01',
      '2026-04-10',
    )
    expect(folded.net_pnl).toBe(0)
  })
})
