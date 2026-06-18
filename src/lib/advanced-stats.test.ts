import { describe, expect, it } from 'vitest'
import {
  cohortStats,
  compositeScore,
  dailyEquitySeries,
  dailyStats,
  drawdownStats,
  expectancyDollars,
  expectancyR,
  extremeStats,
  holdTimeBuckets,
  maeMfeStats,
  maeScatter,
  mfeScatter,
  payoffRatio,
  pnlByHour,
  pnlByMonth,
  pnlByWeek,
  pnlByWeekday,
  profitFactor,
  rDistribution,
  ratioStats,
  sqn,
  streakStats,
} from './advanced-stats'
import { execution, tradeRecord } from '@/test/fixtures'

// Helper: build a trade whose computed net PNL matches `pnl`. Uses NQ micro
// ($2 / handle, $0.62 fee × 2 sides = $1.24 fees) so even small dollar
// values produce enough handles of price movement to clear the scratch
// threshold (NQ: 4 handles); pnl=0 deliberately sits in the scratch band.
//
// `overrides.executions` is treated as time-only — buy/sell times are read
// from the first two entries but their prices are replaced with values that
// produce the requested net pnl. That way callers can place a trade on a
// specific clock/date without clobbering the price movement.
function tradeWithPnl(
  pnl: number,
  overrides: Parameters<typeof tradeRecord>[0] = {},
) {
  const FEES = 1.24
  const HANDLE_VALUE = 2
  const handles = pnl === 0 ? 0 : (pnl + FEES) / HANDLE_VALUE
  const { executions: execOverrides, ...rest } = overrides
  const buyTime = execOverrides?.[0]?.time ?? '2026-04-15T14:30:00.000Z'
  const sellTime = execOverrides?.[1]?.time ?? '2026-04-15T14:45:00.000Z'
  return tradeRecord({
    symbol: 'NQ',
    contract_type: 'micro',
    executions: [
      execution({ kind: 'buy', price: 20000, time: buyTime }),
      execution({ kind: 'sell', price: 20000 + handles, time: sellTime }),
    ],
    ...rest,
  })
}

describe('profitFactor', () => {
  it('returns wins/|losses|', () => {
    const trades = [tradeWithPnl(100), tradeWithPnl(200), tradeWithPnl(-100)]
    expect(profitFactor(trades)).toBeCloseTo(3, 5)
  })

  it('returns Infinity when there are wins but no losses', () => {
    expect(profitFactor([tradeWithPnl(100)])).toBe(Infinity)
  })

  it('returns null on empty input', () => {
    expect(profitFactor([])).toBeNull()
  })

  it('returns null when every trade is a scratch', () => {
    expect(profitFactor([tradeWithPnl(0), tradeWithPnl(0)])).toBeNull()
  })
})

describe('payoffRatio', () => {
  it('returns avg_win / |avg_loss|', () => {
    const trades = [tradeWithPnl(200), tradeWithPnl(100), tradeWithPnl(-50)]
    // avg_win=150, avg_loss=-50 -> 3
    expect(payoffRatio(trades)).toBeCloseTo(3, 5)
  })

  it('returns null without both wins and losses', () => {
    expect(payoffRatio([tradeWithPnl(100), tradeWithPnl(200)])).toBeNull()
    expect(payoffRatio([tradeWithPnl(-50)])).toBeNull()
  })
})

describe('expectancyR', () => {
  it('returns mean R-multiple, ignoring trades without a stop', () => {
    const trades = [
      tradeWithPnl(100, { stop_loss: 100 }), // 1R
      tradeWithPnl(-50, { stop_loss: 100 }), // -0.5R
      tradeWithPnl(200, { stop_loss: 0 }), // ignored
    ]
    expect(expectancyR(trades)).toBeCloseTo(0.25, 5)
  })

  it('returns null when no trade has a stop', () => {
    expect(expectancyR([tradeWithPnl(100, { stop_loss: 0 })])).toBeNull()
  })

  it('skips scratch trades', () => {
    const trades = [
      tradeWithPnl(100, { stop_loss: 100 }), // 1R
      tradeWithPnl(-50, { stop_loss: 100 }), // -0.5R
      tradeWithPnl(0, { stop_loss: 100 }), // scratch — excluded
    ]
    expect(expectancyR(trades)).toBeCloseTo(0.25, 5)
  })
})

describe('expectancyDollars', () => {
  it('uses (win% * avg_win) - (loss% * |avg_loss|)', () => {
    const trades = [tradeWithPnl(100), tradeWithPnl(100), tradeWithPnl(-50), tradeWithPnl(-50)]
    // 0.5 * 100 + 0.5 * -50 = 25
    expect(expectancyDollars(trades)).toBeCloseTo(25, 5)
  })

  it('returns null on empty / scratch-only input', () => {
    expect(expectancyDollars([])).toBeNull()
    expect(expectancyDollars([tradeWithPnl(0)])).toBeNull()
  })
})

describe('sqn', () => {
  it('is √n × meanR / stdevR', () => {
    const trades = [
      tradeWithPnl(100, { stop_loss: 100 }),
      tradeWithPnl(200, { stop_loss: 100 }),
      tradeWithPnl(-50, { stop_loss: 100 }),
      tradeWithPnl(-50, { stop_loss: 100 }),
    ]
    const v = sqn(trades)!
    // R values: 1, 2, -0.5, -0.5; mean = 0.5; sd ≈ 1.224745
    // √4 * 0.5 / 1.224745 ≈ 0.8165
    expect(v).toBeCloseTo(0.8165, 3)
  })

  it('returns null with too few stop-defined trades', () => {
    expect(sqn([tradeWithPnl(100, { stop_loss: 100 })])).toBeNull()
  })

  it('skips scratch trades when computing R', () => {
    const trades = [
      tradeWithPnl(100, { stop_loss: 100 }),
      tradeWithPnl(200, { stop_loss: 100 }),
      tradeWithPnl(-50, { stop_loss: 100 }),
      tradeWithPnl(-50, { stop_loss: 100 }),
      // scratches that would otherwise add zeros to the R distribution
      tradeWithPnl(0, { stop_loss: 100 }),
      tradeWithPnl(0, { stop_loss: 100 }),
    ]
    expect(sqn(trades)).toBeCloseTo(0.8165, 3)
  })
})

describe('streakStats', () => {
  it('tracks longest win, longest loss, and signed current', () => {
    const trades = [
      tradeWithPnl(100, { date: '2026-04-01' }),
      tradeWithPnl(100, { date: '2026-04-02' }),
      tradeWithPnl(-50, { date: '2026-04-03' }),
      tradeWithPnl(-50, { date: '2026-04-04' }),
      tradeWithPnl(-50, { date: '2026-04-05' }),
      tradeWithPnl(100, { date: '2026-04-06' }),
    ]
    expect(streakStats(trades)).toEqual({ longestWin: 2, longestLoss: 3, current: 1 })
  })

  it('ends an active losing streak with negative current', () => {
    const trades = [
      tradeWithPnl(100, { date: '2026-04-01' }),
      tradeWithPnl(-50, { date: '2026-04-02' }),
      tradeWithPnl(-50, { date: '2026-04-03' }),
    ]
    expect(streakStats(trades).current).toBe(-2)
  })

  it('handles empty input', () => {
    expect(streakStats([])).toEqual({ longestWin: 0, longestLoss: 0, current: 0 })
  })

  it('an override day breaks the win/loss streak', () => {
    const trades = [
      tradeWithPnl(100, { date: '2026-04-01' }),
      tradeWithPnl(100, { date: '2026-04-02' }),
      // 2026-04-03 is an override day → breaks the run.
      tradeWithPnl(100, { date: '2026-04-04' }),
      tradeWithPnl(100, { date: '2026-04-05' }),
    ]
    const overrides = new Map([['2026-04-03', -250]])
    const s = streakStats(trades, overrides)
    // Without the override this would be a 4-win streak; the tilt day splits
    // it into two runs of 2, and the most recent run (the current) is 2.
    expect(s.longestWin).toBe(2)
    expect(s.current).toBe(2)
  })

  it('an override day as the latest activity ends the current streak at 0', () => {
    const trades = [
      tradeWithPnl(100, { date: '2026-04-01' }),
      tradeWithPnl(100, { date: '2026-04-02' }),
    ]
    const overrides = new Map([['2026-04-03', -250]])
    expect(streakStats(trades, overrides).current).toBe(0)
  })

  it('ignores scratch trades — neither extends nor breaks a streak', () => {
    const trades = [
      tradeWithPnl(100, { date: '2026-04-01' }),
      tradeWithPnl(100, { date: '2026-04-02' }),
      tradeWithPnl(0, { date: '2026-04-03' }), // scratch
      tradeWithPnl(100, { date: '2026-04-04' }),
    ]
    const s = streakStats(trades)
    // 3 winners with a scratch in the middle should read as 3 in a row.
    expect(s.current).toBe(3)
    expect(s.longestWin).toBe(3)
  })

  it('orders by execution time within the same date', () => {
    const earlier = tradeWithPnl(100, {
      date: '2026-04-01',
      executions: [
        execution({ kind: 'buy', time: '2026-04-01T09:00:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-01T09:05:00.000Z' }),
      ],
    })
    const later = tradeWithPnl(-50, {
      date: '2026-04-01',
      executions: [
        execution({ kind: 'buy', time: '2026-04-01T11:00:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-01T11:05:00.000Z' }),
      ],
    })
    // Pass them in the wrong order — the function should re-sort.
    const s = streakStats([later, earlier])
    expect(s.current).toBe(-1) // last trade chronologically is the loser
  })

  it('breaks same-second ties deterministically on id', () => {
    // Two scalps starting at the exact same second on the same date —
    // execution times only have second precision, so the sort must
    // fall back to id to stay deterministic across re-fetches.
    const a = tradeWithPnl(100, {
      id: 'aaa',
      date: '2026-04-01',
      executions: [
        execution({ kind: 'buy', time: '2026-04-01T09:30:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-01T09:30:30.000Z' }),
      ],
    })
    const b = tradeWithPnl(-50, {
      id: 'bbb',
      date: '2026-04-01',
      executions: [
        execution({ kind: 'buy', time: '2026-04-01T09:30:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-01T09:30:30.000Z' }),
      ],
    })
    // id 'aaa' < 'bbb', so 'a' (the win) sorts first → current streak is
    // the loser. Both input orders must produce the same answer.
    expect(streakStats([a, b]).current).toBe(-1)
    expect(streakStats([b, a]).current).toBe(-1)
  })
})

describe('dailyEquitySeries', () => {
  it('applies adjustments peak-neutrally — deposit raises equity and peak together so dd is trade-only', () => {
    const dates = [
      '2026-04-19', // empty
      '2026-04-30', // deposit lands
      '2026-05-01', // big loss
    ]
    const trades = [
      tradeWithPnl(-500, { date: '2026-05-01' }),
    ]
    const adjustments = new Map<string, number>([['2026-04-30', 10_000]])
    const series = dailyEquitySeries(trades, dates, 0, adjustments)
    expect(series[0]).toMatchObject({ equity: 0, peak: 0, dd: 0, ddPct: 0 })
    // Deposit lifts both equity and peak; dd unchanged.
    expect(series[1]).toMatchObject({ equity: 10_000, peak: 10_000, dd: 0 })
    // $500 loss measured against the $10k post-deposit peak.
    expect(series[2].equity).toBeCloseTo(9_500, 2)
    expect(series[2].peak).toBe(10_000)
    expect(series[2].dd).toBeCloseTo(-500, 2)
    expect(series[2].ddPct).toBeCloseTo(-0.05, 4)
    // `pnl` stays trade-only — adjustment doesn't pollute it.
    expect(series[1].pnl).toBe(0)
    expect(series[2].pnl).toBeCloseTo(-500, 2)
  })

  it('withdrawals are peak-neutral too — no fictitious drawdown', () => {
    const dates = ['2026-04-19', '2026-04-20', '2026-04-21']
    const trades = [tradeWithPnl(200, { date: '2026-04-19' })]
    // Big withdrawal on day 2 — equity drops but peak drops the same
    // amount, so dd stays 0 (no trade activity that day).
    const adjustments = new Map<string, number>([['2026-04-20', -500]])
    const series = dailyEquitySeries(trades, dates, 0, adjustments)
    expect(series[0].dd).toBeCloseTo(0, 2)
    expect(series[1].dd).toBeCloseTo(0, 2)
    expect(series[2].dd).toBeCloseTo(0, 2)
  })

  it('runs cumulative equity and tracks peak/dd', () => {
    const trades = [
      tradeWithPnl(100, { date: '2026-04-01' }),
      tradeWithPnl(-300, { date: '2026-04-02' }),
      tradeWithPnl(50, { date: '2026-04-03' }),
    ]
    const dates = ['2026-04-01', '2026-04-02', '2026-04-03']
    const series = dailyEquitySeries(trades, dates, 10000)
    expect(series[0].equity).toBeCloseTo(10100, 5)
    expect(series[1].equity).toBeCloseTo(9800, 5)
    expect(series[1].dd).toBeCloseTo(-300, 5)
    expect(series[2].equity).toBeCloseTo(9850, 5)
    expect(series[2].dd).toBeCloseTo(-250, 5)
  })

  it('fills no-trade days with zero PNL', () => {
    const trades = [tradeWithPnl(100, { date: '2026-04-01' })]
    const series = dailyEquitySeries(trades, ['2026-04-01', '2026-04-02'], 0)
    expect(series[0].pnl).toBeCloseTo(100, 5)
    expect(series[1].pnl).toBe(0)
    expect(series[1].equity).toBeCloseTo(100, 5)
  })
})

describe('drawdownStats', () => {
  it('computes max drawdown and recovery factor', () => {
    const trades = [
      tradeWithPnl(100, { date: '2026-04-01' }),
      tradeWithPnl(-200, { date: '2026-04-02' }),
      tradeWithPnl(150, { date: '2026-04-03' }),
    ]
    const series = dailyEquitySeries(
      trades,
      ['2026-04-01', '2026-04-02', '2026-04-03'],
      0,
    )
    const stats = drawdownStats(series, 50)
    expect(stats.maxDd).toBeCloseTo(-200, 5)
    expect(stats.recoveryFactor).toBeCloseTo(0.25, 5) // 50 / 200
    expect(stats.maxDdDurationDays).toBeGreaterThanOrEqual(1)
  })

  it('returns zeros on empty series', () => {
    const stats = drawdownStats([], 0)
    expect(stats.maxDd).toBe(0)
    expect(stats.recoveryFactor).toBeNull()
    expect(stats.maxDdDurationDays).toBe(0)
  })
})

describe('ratioStats', () => {
  it('returns null on too-short series', () => {
    expect(ratioStats([])).toEqual({
      sharpe: null,
      sortino: null,
      calmar: null,
      kRatio: null,
      tailRatio: null,
    })
  })

  it('produces finite numbers for a varied series', () => {
    const trades: ReturnType<typeof tradeWithPnl>[] = []
    const dates: string[] = []
    for (let i = 0; i < 30; i++) {
      const d = `2026-04-${String(i + 1).padStart(2, '0')}`
      trades.push(tradeWithPnl(i % 3 === 0 ? -50 : 100, { date: d }))
      dates.push(d)
    }
    const series = dailyEquitySeries(trades, dates, 0)
    const stats = ratioStats(series)
    expect(Number.isFinite(stats.sharpe!)).toBe(true)
    expect(Number.isFinite(stats.sortino!)).toBe(true)
    expect(Number.isFinite(stats.kRatio!)).toBe(true)
    expect(Number.isFinite(stats.tailRatio!)).toBe(true)
  })

  it('uses the canonical N-basis downside deviation for Sortino', () => {
    // Daily PNL +100, -50, +100. Downside deviation = sqrt((-50)² / 3)
    // (squared losses ÷ TOTAL days), NOT sqrt((-50)² / 1) (÷ loss count).
    // mean = 50, dsd = 50/√3, so Sortino = √3 × √252.
    const dates = ['2026-04-01', '2026-04-02', '2026-04-03']
    const series = dailyEquitySeries(
      [
        tradeWithPnl(100, { date: dates[0] }),
        tradeWithPnl(-50, { date: dates[1] }),
        tradeWithPnl(100, { date: dates[2] }),
      ],
      dates,
      0,
    )
    expect(ratioStats(series).sortino).toBeCloseTo(Math.sqrt(3) * Math.sqrt(252), 4)
  })

  it('tail ratio stays bounded when a single boundary loss is microscopic', () => {
    // 60 days, one microscopic loss (-$0.01) plus normal PNL. Under the
    // old |p95|/|p5| formula a near-zero boundary value would blow the
    // ratio up to ~10,000+. The averaged-tail variant pulls in three or
    // more losses so the divisor reflects the user's typical loser, not
    // the boundary outlier.
    const trades: ReturnType<typeof tradeWithPnl>[] = []
    const dates: string[] = []
    for (let i = 0; i < 60; i++) {
      const d = `2026-${String(Math.floor(i / 30) + 4).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`
      // One microscopic loss, rest is alternating real wins (+$200) and
      // real losses (-$50).
      const pnl = i === 0 ? -0.01 : i % 2 === 0 ? 200 : -50
      trades.push(tradeWithPnl(pnl, { date: d }))
      dates.push(d)
    }
    const series = dailyEquitySeries(trades, dates, 0)
    const stats = ratioStats(series)
    expect(stats.tailRatio).not.toBeNull()
    // 5% of 60 = 3-sample tails. Bottom three losses are
    // (-50, -50, -0.01) averaging to -33.33; top three wins are
    // (200, 200, 200) averaging to 200. Ratio ≈ 6.
    expect(stats.tailRatio!).toBeLessThan(50)
    expect(Number.isFinite(stats.tailRatio!)).toBe(true)
  })

  it('tail ratio returns null on samples smaller than 30 days', () => {
    const trades: ReturnType<typeof tradeWithPnl>[] = []
    const dates: string[] = []
    for (let i = 0; i < 20; i++) {
      const d = `2026-04-${String(i + 1).padStart(2, '0')}`
      trades.push(tradeWithPnl(i % 3 === 0 ? -50 : 100, { date: d }))
      dates.push(d)
    }
    const series = dailyEquitySeries(trades, dates, 0)
    const stats = ratioStats(series)
    expect(stats.tailRatio).toBeNull()
  })
})

describe('rDistribution', () => {
  it('places each trade into one bucket and accumulates', () => {
    // Bucket label = nearest integer R, with half-bin boundaries at
    // ±0.5R. So +1R covers (0, 1.5], +2R covers (1.5, 2.5], and so on.
    // A 1.05R loss (slippage past stop) sits in -1R, not -2R.
    const trades = [
      tradeWithPnl(50, { stop_loss: 100 }), // +0.5R -> +1R
      tradeWithPnl(200, { stop_loss: 100 }), // +2R -> +2R
      tradeWithPnl(-50, { stop_loss: 100 }), // -0.5R -> -1R
      tradeWithPnl(-105, { stop_loss: 100 }), // -1.05R (over stop) -> -1R
      tradeWithPnl(-200, { stop_loss: 100 }), // -2R -> -2R
      tradeWithPnl(600, { stop_loss: 100 }), // +6R -> 5R+
    ]
    const buckets = rDistribution(trades)
    const get = (label: string) => buckets.find(b => b.label === label)!
    expect(get('+1R').count).toBe(1)
    expect(get('+2R').count).toBe(1)
    expect(get('-1R').count).toBe(2)
    expect(get('-2R').count).toBe(1)
    expect(get('5R+').count).toBe(1)
    // Cumulative ends at total.
    expect(buckets[buckets.length - 1].cumulative).toBe(6)
  })

  it('skips trades without a stop', () => {
    const buckets = rDistribution([tradeWithPnl(100, { stop_loss: 0 })])
    expect(buckets.every(b => b.count === 0)).toBe(true)
  })

  it('skips scratch trades', () => {
    const buckets = rDistribution([
      tradeWithPnl(50, { stop_loss: 100 }),
      tradeWithPnl(0, { stop_loss: 100 }), // scratch — excluded from buckets
    ])
    const total = buckets.reduce((n, b) => n + b.count, 0)
    expect(total).toBe(1)
  })
})

describe('maeMfeStats', () => {
  it('averages drawdown and runup separately', () => {
    const trades = [
      tradeWithPnl(100, { drawdown: 20, runup: 200, stop_loss: 100 }),
      tradeWithPnl(-50, { drawdown: 100, runup: 30, stop_loss: 100 }),
    ]
    const s = maeMfeStats(trades)
    expect(s.avgMae).toBe(60) // (20+100)/2
    expect(s.avgMfe).toBe(115) // (200+30)/2
    // mfeEfficiency only counts winners.
    expect(s.mfeEfficiency).toBeCloseTo(100 / 200, 5)
    // maeStopRatio only counts losers.
    expect(s.maeStopRatio).toBeCloseTo(100 / 100, 5)
  })
})

describe('scatter helpers', () => {
  it('maeScatter emits one point per trade with valid pnl', () => {
    const trades = [tradeWithPnl(100, { drawdown: 20 }), tradeWithPnl(-50, { drawdown: 100 })]
    const pts = maeScatter(trades)
    expect(pts).toHaveLength(2)
    expect(pts[0].x).toBe(20)
    expect(pts[0].y).toBeCloseTo(100, 5)
    expect(pts[0].outcome).toBe('win')
    expect(pts[1].x).toBe(100)
    expect(pts[1].y).toBeCloseTo(-50, 5)
    expect(pts[1].outcome).toBe('loss')
  })

  it('mfeScatter skips trades with no runup', () => {
    const trades = [tradeWithPnl(100, { runup: 200 }), tradeWithPnl(-50, { runup: null })]
    expect(mfeScatter(trades)).toHaveLength(1)
  })
})

describe('time-of-day / weekday / month aggregations', () => {
  it('pnlByHour buckets by the typed NY wallclock hour', () => {
    // Times are stored as `${date}T${HH:MM:SS}.000Z` literals — the typed
    // NY wallclock encoded as fictional UTC. So a 10:30 stored time
    // buckets into hour 10, no timezone math involved.
    const t = tradeWithPnl(100, {
      executions: [
        execution({ kind: 'buy', time: '2026-04-15T10:30:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-15T10:45:00.000Z' }),
      ],
    })
    const arr = pnlByHour([t])
    expect(arr).toHaveLength(24)
    expect(arr[10].count).toBe(1)
    expect(arr[10].pnl).toBeCloseTo(100, 5)
  })

  it('pnlByWeekday counts wins and losses per weekday', () => {
    // April 15 2026 is a Wednesday (day index 3).
    const trades = [
      tradeWithPnl(100, { date: '2026-04-15' }),
      tradeWithPnl(-50, { date: '2026-04-15' }),
    ]
    const arr = pnlByWeekday(trades)
    const wed = arr[3]
    expect(wed.name).toBe('Wed')
    expect(wed.wins).toBe(1)
    expect(wed.losses).toBe(1)
    expect(wed.pnl).toBeCloseTo(50, 5)
  })

  it('pnlByMonth groups by YYYY-MM', () => {
    const trades = [
      tradeWithPnl(100, { date: '2026-03-31' }),
      tradeWithPnl(50, { date: '2026-04-01' }),
      tradeWithPnl(-25, { date: '2026-04-30' }),
    ]
    const arr = pnlByMonth(trades)
    expect(arr).toHaveLength(2)
    expect(arr[0].month).toBe('2026-03')
    expect(arr[0].count).toBe(1)
    expect(arr[0].pnl).toBeCloseTo(100, 5)
    expect(arr[1].month).toBe('2026-04')
    expect(arr[1].count).toBe(2)
    expect(arr[1].pnl).toBeCloseTo(25, 5)
  })
})

describe('holdTimeBuckets', () => {
  it('places a 7-minute trade into the 5-15m bucket', () => {
    const t = tradeWithPnl(100, {
      executions: [
        execution({ kind: 'buy', time: '2026-04-15T10:00:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-15T10:07:00.000Z' }),
      ],
    })
    const buckets = holdTimeBuckets([t])
    const target = buckets.find(b => b.label === '5-15m')!
    expect(target.wins).toBe(1)
  })

  it('places losers into the losses column', () => {
    const t = tradeWithPnl(-50, {
      executions: [
        execution({ kind: 'buy', time: '2026-04-15T10:00:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-15T10:25:00.000Z' }),
      ],
    })
    const buckets = holdTimeBuckets([t])
    const target = buckets.find(b => b.label === '15-30m')!
    expect(target.losses).toBe(1)
  })
})

describe('compositeScore', () => {
  it('returns a finite number in [0, 100]', () => {
    const score = compositeScore({
      profitFactor: 1.5,
      payoff: 1.2,
      winRate: 0.55,
      maxDdPct: -0.1,
      recoveryFactor: 2,
      dailyPnls: [100, -20, 50, 30, -10, 80],
      netPnl: 230,
      wins: 4,
      losses: 2,
    })
    expect(score.total).toBeGreaterThanOrEqual(0)
    expect(score.total).toBeLessThanOrEqual(100)
    for (const v of Object.values(score.parts)) {
      if (v === null) continue
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('zeros profit-factor sub-score for losing systems', () => {
    const score = compositeScore({
      profitFactor: 0.5,
      payoff: 0.5,
      winRate: 0.3,
      maxDdPct: -0.5,
      recoveryFactor: 0.2,
      dailyPnls: [-50, -30],
      netPnl: -80,
      wins: 1,
      losses: 3,
    })
    expect(score.parts.profitFactor).toBe(20) // floor of stepWindow
    expect(score.parts.recovery).toBe(0)
    // length ≥ 2 but netPnl ≤ 0 → consistency clamped to 0 (not null).
    expect(score.parts.consistency).toBe(0)
  })

  it('treats a pure-winners window as max PF + max payoff + max recovery', () => {
    // The single-2R-trade case the user hit: no losers, no drawdown.
    // Previously this scored ~35 because PF=Infinity, payoff=null, and
    // recoveryFactor=null all mapped to 0. Now those three components
    // should be at the ceiling; consistency is null (one day) so the
    // remaining five reweight pro-rata.
    const score = compositeScore({
      profitFactor: Infinity,
      payoff: null,
      winRate: 1.0,
      maxDdPct: 0,
      recoveryFactor: null,
      dailyPnls: [200],
      netPnl: 200,
      wins: 1,
      losses: 0,
    })
    expect(score.parts.profitFactor).toBe(100)
    expect(score.parts.payoff).toBe(100)
    expect(score.parts.recovery).toBe(100)
    expect(score.parts.maxDd).toBe(100)
    expect(score.parts.winRate).toBe(100)
    expect(score.parts.consistency).toBeNull()
    // All 5 non-null components are 100, reweighted to 100% → total = 100.
    expect(score.total).toBe(100)
  })

  it('treats maxDd as null when ddPct underflows on a fresh-account window', () => {
    // accountStartEquity = 0 (no prior trades/adjustments) plus a window
    // where a small early peak gets dwarfed by a later loss. ddPct goes
    // below -100% — a "% of peak" artefact, not a real wipe. Mark maxDd
    // null and reweight rather than clamping the sub-score to 0 (the
    // misleading "you lost everything" reading the user actually saw).
    const score = compositeScore({
      profitFactor: 1.12,
      payoff: 1.28,
      winRate: 0.47,
      maxDdPct: -3.0, // 300% drawdown of small running peak
      recoveryFactor: 0.5, // recovery legitimately ≤ 1 → stays at 0
      dailyPnls: [50, -30, 80, -120, 40, -10],
      netPnl: 10,
      wins: 20,
      losses: 18,
      peakEquity: 0,
    })
    expect(score.parts.maxDd).toBeNull()
    // Other sub-scores still compute against the rest of the formula.
    expect(score.parts.profitFactor).toBeGreaterThan(0)
    expect(score.parts.winRate).toBeGreaterThan(0)
    // Total reweights from 80% → 100% by dropping maxDd's 20% slice.
    expect(Number.isFinite(score.total)).toBe(true)
  })

  it('does NOT null maxDd when accountStartEquity is anchored even if ddPct underflows', () => {
    // Same ddPct underflow, but with a real $10k starting equity — the
    // user actually lost more than 100% of their capital. The metric is
    // meaningful: max possible loss. Don't hide it as n/a.
    const score = compositeScore({
      profitFactor: 1.12,
      payoff: 1.28,
      winRate: 0.47,
      maxDdPct: -3.0,
      recoveryFactor: 0.5,
      dailyPnls: [50, -30, 80, -120, 40, -10],
      netPnl: 10,
      wins: 20,
      losses: 18,
      peakEquity: 10_500,
    })
    expect(score.parts.maxDd).toBe(0)
  })

  it('reweights total when consistency is null instead of docking 10 points', () => {
    // Same component values, but with two days (consistency computable)
    // vs one day (consistency null + reweighted). The reweighted total
    // must not be lower than the equivalent computable version.
    const oneDay = compositeScore({
      profitFactor: 2.0,
      payoff: 1.5,
      winRate: 0.5,
      maxDdPct: -0.2,
      recoveryFactor: 2.5,
      dailyPnls: [100],
      netPnl: 100,
      wins: 1,
      losses: 0,
    })
    expect(oneDay.parts.consistency).toBeNull()
    // Five sub-scores @ 0.25/0.20/0.20/0.15/0.10 weights, divided by 0.9
    // → equivalent to 0.278/0.222/0.222/0.167/0.111 — sums to ~1.000.
    // Total should be in a sensible range, not artificially low.
    expect(oneDay.total).toBeGreaterThan(50)
  })
})

describe('cohortStats', () => {
  it('summarises a cohort', () => {
    const trades = [
      tradeWithPnl(100, { drawdown: 20, runup: 200, stop_loss: 100 }),
      tradeWithPnl(50, { drawdown: 30, runup: 100, stop_loss: 100 }),
    ]
    const s = cohortStats(trades)
    expect(s.count).toBe(2)
    expect(s.avgRr).toBeCloseTo(0.75, 5)
    expect(s.avgMae).toBe(25)
    expect(s.avgMfe).toBe(150)
    expect(s.avgFees).toBeGreaterThan(0)
  })
})

describe('extremeStats', () => {
  it('finds the largest single-trade win and loss', () => {
    const trades = [
      tradeWithPnl(50),
      tradeWithPnl(-20),
      tradeWithPnl(180), // biggest win
      tradeWithPnl(-65), // biggest loss
      tradeWithPnl(30),
    ]
    const e = extremeStats(trades)
    expect(e.largestWin).toBeCloseTo(180, 5)
    expect(e.largestLoss).toBeCloseTo(-65, 5)
  })

  it('returns null on each side when no winners or no losers', () => {
    const onlyWin = extremeStats([tradeWithPnl(100)])
    expect(onlyWin.largestWin).toBeCloseTo(100, 5)
    expect(onlyWin.largestLoss).toBeNull()
    const onlyLoss = extremeStats([tradeWithPnl(-50)])
    expect(onlyLoss.largestWin).toBeNull()
    expect(onlyLoss.largestLoss).toBeCloseTo(-50, 5)
    expect(extremeStats([])).toEqual({ largestWin: null, largestLoss: null })
  })
})

describe('dailyStats', () => {
  it('summarises trading days, ignoring zero-pnl days', () => {
    // 4 trading days with pnls [100, -40, 60, -10]; one no-trade day at 0.
    const series = [
      { date: '2026-04-01', pnl: 100, equity: 100, peak: 100, dd: 0, ddPct: 0 },
      { date: '2026-04-02', pnl: 0, equity: 100, peak: 100, dd: 0, ddPct: 0 },
      { date: '2026-04-03', pnl: -40, equity: 60, peak: 100, dd: -40, ddPct: -0.4 },
      { date: '2026-04-04', pnl: 60, equity: 120, peak: 120, dd: 0, ddPct: 0 },
      { date: '2026-04-05', pnl: -10, equity: 110, peak: 120, dd: -10, ddPct: -0.083 },
    ]
    const d = dailyStats(series)
    expect(d.bestDay).toBe(100)
    expect(d.worstDay).toBe(-40)
    expect(d.avgDailyPnl).toBeCloseTo((100 - 40 + 60 - 10) / 4, 5)
    expect(d.greenDays).toBe(2)
    expect(d.redDays).toBe(2)
    expect(d.dayWinRate).toBe(0.5)
  })

  it('returns all-null on a fully no-trade series', () => {
    const series = [
      { date: '2026-04-01', pnl: 0, equity: 0, peak: 0, dd: 0, ddPct: 0 },
    ]
    const d = dailyStats(series)
    expect(d.bestDay).toBeNull()
    expect(d.worstDay).toBeNull()
    expect(d.avgDailyPnl).toBeNull()
    expect(d.dayWinRate).toBeNull()
  })
})

describe('pnlByWeek', () => {
  it('groups trades into Mon-start weeks', () => {
    // 2026-04-13 = Mon, 2026-04-15 = Wed, 2026-04-19 = Sun, 2026-04-20 = next Mon
    const trades = [
      tradeWithPnl(100, { date: '2026-04-13' }),
      tradeWithPnl(50, { date: '2026-04-15' }),
      tradeWithPnl(-30, { date: '2026-04-19' }),
      tradeWithPnl(20, { date: '2026-04-20' }),
    ]
    const weeks = pnlByWeek(trades)
    expect(weeks).toHaveLength(2)
    expect(weeks[0].weekStart).toBe('2026-04-13')
    expect(weeks[0].pnl).toBeCloseTo(100 + 50 - 30, 5)
    expect(weeks[0].count).toBe(3)
    expect(weeks[1].weekStart).toBe('2026-04-20')
    expect(weeks[1].pnl).toBeCloseTo(20, 5)
  })

  it('rolls a Sunday trade back to the prior Monday', () => {
    // 2026-04-19 is a Sunday; week start should be Monday 2026-04-13.
    const weeks = pnlByWeek([tradeWithPnl(100, { date: '2026-04-19' })])
    expect(weeks).toHaveLength(1)
    expect(weeks[0].weekStart).toBe('2026-04-13')
  })
})

describe('pnlByHour mode', () => {
  it("buckets by the trade's last execution when mode='last'", () => {
    // Buy at 09:00, sell at 14:30 — under 'first' lands in hour 9, under
    // 'last' it lands in hour 14.
    const t = tradeWithPnl(100, {
      executions: [
        execution({ kind: 'buy', time: '2026-04-15T09:00:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-15T14:30:00.000Z' }),
      ],
    })
    const first = pnlByHour([t], 'first')
    const last = pnlByHour([t], 'last')
    expect(first[9].count).toBe(1)
    expect(first[14].count).toBe(0)
    expect(last[14].count).toBe(1)
    expect(last[9].count).toBe(0)
  })
})
