import { describe, expect, it } from 'vitest'
import { adjustmentRecord, execution, symbolSnapshot, tradeRecord } from '@/test/fixtures'
import { equityBefore, netPnlByDate, sumNetPnl } from '@/lib/day-pnl'
import { dailyEquitySeries } from '@/lib/advanced-stats'
import { computeCandles } from '@/lib/trade-stats'
import type { Bucket } from '@/lib/buckets'

// NQ mini, +10 handles × $50 − $4.50 fees = +195.5 net.
function winningTrade(date = '2026-04-01') {
  return tradeRecord({
    date,
    symbol_spec: symbolSnapshot(),
    executions: [
      execution({ kind: 'buy', price: 20000, contracts: 1 }),
      execution({ kind: 'sell', price: 20010, contracts: 1 }),
    ],
    stop_loss: 100,
    profit_target: 200,
  })
}

function bucketWith(trades: ReturnType<typeof tradeRecord>[], rangeStart: string, rangeEnd = rangeStart): Bucket {
  return { key: rangeStart, label: rangeStart, rangeStart, rangeEnd, navTarget: `/day/${rangeStart}`, trades }
}

describe('netPnlByDate', () => {
  it('sums trade net pnl per day', () => {
    const m = netPnlByDate([winningTrade('2026-04-01'), winningTrade('2026-04-01'), winningTrade('2026-04-02')])
    expect(m.get('2026-04-01')).toBeCloseTo(391, 5) // 195.5 × 2
    expect(m.get('2026-04-02')).toBeCloseTo(195.5, 5)
  })

  it('override replaces the day’s trade sum wholesale', () => {
    const overrides = new Map([['2026-04-01', -1000]])
    const m = netPnlByDate([winningTrade('2026-04-01'), winningTrade('2026-04-01')], overrides)
    expect(m.get('2026-04-01')).toBe(-1000) // not 391
  })

  it('an override-only day (no trades) still appears', () => {
    const overrides = new Map([['2026-04-03', -250]])
    const m = netPnlByDate([winningTrade('2026-04-01')], overrides)
    expect(m.get('2026-04-03')).toBe(-250)
    expect(m.get('2026-04-01')).toBeCloseTo(195.5, 5)
  })
})

describe('sumNetPnl', () => {
  it('totals the map, optionally filtered by date', () => {
    const m = new Map([
      ['2026-04-01', 100],
      ['2026-04-02', -250],
      ['2026-04-03', 50],
    ])
    expect(sumNetPnl(m)).toBe(-100)
    expect(sumNetPnl(m, d => d < '2026-04-03')).toBe(-150)
  })
})

describe('dailyEquitySeries with overrides', () => {
  it('uses the override for that day’s PNL step', () => {
    const dates = ['2026-04-01', '2026-04-02']
    const overrides = new Map([['2026-04-02', -1000]])
    const series = dailyEquitySeries(
      [winningTrade('2026-04-01'), winningTrade('2026-04-02')],
      dates,
      0,
      undefined,
      overrides,
    )
    expect(series[0].equity).toBeCloseTo(195.5, 5)
    // Day 2's trade (+195.5) is replaced by the −1000 override.
    expect(series[1].pnl).toBe(-1000)
    expect(series[1].equity).toBeCloseTo(195.5 - 1000, 5)
  })
})

describe('computeCandles with overrides', () => {
  it('replaces an override day’s trades (and their fees)', () => {
    const day = bucketWith([winningTrade('2026-04-01')], '2026-04-01')
    const overrides = new Map([['2026-04-01', -300]])
    const [c] = computeCandles([day], new Map(), 0, overrides)
    expect(c.close).toBe(-300) // not +195.5
    expect(c.low).toBe(-300)
    expect(c.fees).toBe(0) // override is net; the trade's fees are skipped
  })

  it('an override-only day moves a week bucket that has no trades on it', () => {
    // Week bucket Mon–Fri with a trade Mon and a tilt override Wed.
    const week = bucketWith([winningTrade('2026-04-06')], '2026-04-06', '2026-04-10')
    const overrides = new Map([['2026-04-08', -500]])
    const [c] = computeCandles([week], new Map(), 0, overrides)
    expect(c.close).toBeCloseTo(195.5 - 500, 5)
    expect(c.low).toBeCloseTo(195.5 - 500, 5)
  })
})

// `equityBefore` is the single source of the "account equity entering a window"
// baseline — the calendar's per-day scratch band and Overview's and Reports'
// composite/chart baselines all run through it. Expected values are worked out
// by hand rather than compared against a second implementation, so a shared
// mistake can't hide.
describe('equityBefore', () => {
  // A winning trade is +195.5 net (see above); a losing one mirrors it.
  function losingTrade(date: string) {
    return tradeRecord({
      date,
      symbol_spec: symbolSnapshot(),
      executions: [
        execution({ kind: 'buy', price: 20010, contracts: 1 }),
        execution({ kind: 'sell', price: 20000, contracts: 1 }),
      ],
      stop_loss: 100,
      profit_target: 200,
    })
  }

  //   04-01  +195.5 trade          04-05  −204.5 trade
  //   04-03  +1000 deposit         04-08  −400 withdrawal
  //   04-05  −850 override (REPLACES that day's −204.5 trade)
  //   04-07  −125 override on a day with no trades at all
  const overrides = new Map([
    ['2026-04-05', -850],
    ['2026-04-07', -125],
  ])
  const netByDate = () =>
    netPnlByDate([winningTrade('2026-04-01'), losingTrade('2026-04-05')], overrides)
  const adjustments = [
    adjustmentRecord({ date: '2026-04-03', kind: 'deposit', amount: 1000 }),
    adjustmentRecord({ date: '2026-04-08', kind: 'withdraw', amount: 400 }),
  ]

  // Cutoffs land before, exactly on, and after each trade, override and
  // adjustment — "exactly on" is what pins the strictly-before boundary.
  it.each([
    ['2026-04-01', 0], // on the first trade's date
    ['2026-04-02', 195.5],
    ['2026-04-03', 195.5], // on the deposit's date
    ['2026-04-04', 1195.5],
    ['2026-04-05', 1195.5], // on the override's date
    ['2026-04-06', 345.5], // + the −850 override, NOT the −204.5 trade
    ['2026-04-07', 345.5], // on the override-only day
    ['2026-04-08', 220.5], // + the −125 override-only day
    ['2026-04-09', -179.5], // + the −400 withdrawal
  ])('%s → %d', (cutoff, expected) => {
    expect(equityBefore(cutoff, netByDate(), adjustments, 0)).toBeCloseTo(expected, 5)
  })

  it('offsets every cutoff by the account opening balance', () => {
    // Dateless: the opening capital is part of the baseline no matter how
    // early or late the window starts.
    expect(equityBefore('2026-04-01', netByDate(), adjustments, 50_000)).toBeCloseTo(50_000, 5)
    expect(equityBefore('2026-04-09', netByDate(), adjustments, 50_000)).toBeCloseTo(49_820.5, 5)
  })

  it('is unaffected by dates at or after the cutoff', () => {
    const withFuture = netPnlByDate(
      [winningTrade('2026-04-01'), winningTrade('2026-09-01')],
      overrides,
    )
    expect(equityBefore('2026-04-02', withFuture, adjustments, 0)).toBeCloseTo(195.5, 5)
  })

  it('is the opening balance for an account with no activity', () => {
    expect(equityBefore('2026-04-02', new Map(), [], 0)).toBe(0)
    expect(equityBefore('2026-04-02', new Map(), [], 50_000)).toBe(50_000)
  })
})
