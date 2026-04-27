import { describe, expect, it } from 'vitest'
import {
  cohortStats,
  compositeScore,
  dailyEquitySeries,
  drawdownStats,
  expectancyDollars,
  expectancyR,
  holdTimeBuckets,
  kellyFraction,
  maeMfeStats,
  maeScatter,
  mfeScatter,
  payoffRatio,
  pnlByHour,
  pnlByMonth,
  pnlByWeekday,
  profitFactor,
  rDistribution,
  ratioStats,
  sqn,
  streakStats,
} from './advanced-stats'
import { execution, tradeRecord } from '@/test/fixtures'

// Helper: build a trade with a specific net P&L via pnl_override.
// AHPC is set to match the PnL sign so `classifyTrade` agrees with the
// override (otherwise the >|4| handles threshold would mark every trade
// as scratch).
function tradeWithPnl(pnl: number, overrides: Parameters<typeof tradeRecord>[0] = {}) {
  const sellPrice = pnl > 0 ? 20010 : pnl < 0 ? 19990 : 20000
  return tradeRecord({
    pnl_override: pnl,
    executions: [
      execution({ kind: 'buy', price: 20000, time: '2026-04-15T14:30:00.000Z' }),
      execution({ kind: 'sell', price: sellPrice, time: '2026-04-15T14:45:00.000Z' }),
    ],
    ...overrides,
  })
}

describe('profitFactor', () => {
  it('returns wins/|losses|', () => {
    const trades = [tradeWithPnl(100), tradeWithPnl(200), tradeWithPnl(-100)]
    expect(profitFactor(trades)).toBe(3)
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
    expect(payoffRatio(trades)).toBe(3)
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

  it('skips breakeven (scratch) trades', () => {
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
    expect(expectancyDollars(trades)).toBe(25)
  })

  it('returns null on empty / scratch-only input', () => {
    expect(expectancyDollars([])).toBeNull()
    expect(expectancyDollars([tradeWithPnl(0)])).toBeNull()
  })
})

describe('kellyFraction', () => {
  it('caps to [0, 1]', () => {
    // All winners -> payoff ratio is null -> kelly null. Use mixed.
    const trades = [
      tradeWithPnl(100),
      tradeWithPnl(100),
      tradeWithPnl(100),
      tradeWithPnl(-50),
    ]
    const k = kellyFraction(trades)!
    expect(k).toBeGreaterThan(0)
    expect(k).toBeLessThanOrEqual(1)
  })

  it('clamps a negative-edge system to 0', () => {
    const trades = [tradeWithPnl(50), tradeWithPnl(-200), tradeWithPnl(-200)]
    expect(kellyFraction(trades)).toBe(0)
  })

  it('returns null when payoff is undefined', () => {
    expect(kellyFraction([tradeWithPnl(100)])).toBeNull()
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

  it('skips breakeven (scratch) trades when computing R', () => {
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
      tradeWithPnl(100, { trade_date: '2026-04-01' }),
      tradeWithPnl(100, { trade_date: '2026-04-02' }),
      tradeWithPnl(-50, { trade_date: '2026-04-03' }),
      tradeWithPnl(-50, { trade_date: '2026-04-04' }),
      tradeWithPnl(-50, { trade_date: '2026-04-05' }),
      tradeWithPnl(100, { trade_date: '2026-04-06' }),
    ]
    expect(streakStats(trades)).toEqual({ longestWin: 2, longestLoss: 3, current: 1 })
  })

  it('ends an active losing streak with negative current', () => {
    const trades = [
      tradeWithPnl(100, { trade_date: '2026-04-01' }),
      tradeWithPnl(-50, { trade_date: '2026-04-02' }),
      tradeWithPnl(-50, { trade_date: '2026-04-03' }),
    ]
    expect(streakStats(trades).current).toBe(-2)
  })

  it('handles empty input', () => {
    expect(streakStats([])).toEqual({ longestWin: 0, longestLoss: 0, current: 0 })
  })

  it('breaks the current streak on a scratch trade (pnl = 0)', () => {
    const trades = [
      tradeWithPnl(100, { trade_date: '2026-04-01' }),
      tradeWithPnl(100, { trade_date: '2026-04-02' }),
      tradeWithPnl(0, { trade_date: '2026-04-03' }),
      tradeWithPnl(100, { trade_date: '2026-04-04' }),
    ]
    const s = streakStats(trades)
    // The scratch resets the streak; the trailing winner restarts it at 1.
    expect(s.current).toBe(1)
    // Longest still reflects the pre-scratch run.
    expect(s.longestWin).toBe(2)
  })

  it('orders by execution time within the same date', () => {
    const earlier = tradeRecord({
      pnl_override: 100,
      trade_date: '2026-04-01',
      executions: [
        execution({ kind: 'buy', time: '2026-04-01T09:00:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-01T09:05:00.000Z' }),
      ],
    })
    const later = tradeRecord({
      pnl_override: -50,
      trade_date: '2026-04-01',
      executions: [
        execution({ kind: 'buy', time: '2026-04-01T11:00:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-01T11:05:00.000Z' }),
      ],
    })
    // Pass them in the wrong order — the function should re-sort.
    const s = streakStats([later, earlier])
    expect(s.current).toBe(-1) // last trade chronologically is the loser
  })
})

describe('dailyEquitySeries', () => {
  it('runs cumulative equity and tracks peak/dd', () => {
    const trades = [
      tradeWithPnl(100, { trade_date: '2026-04-01' }),
      tradeWithPnl(-300, { trade_date: '2026-04-02' }),
      tradeWithPnl(50, { trade_date: '2026-04-03' }),
    ]
    const dates = ['2026-04-01', '2026-04-02', '2026-04-03']
    const series = dailyEquitySeries(trades, dates, 10000)
    expect(series[0].equity).toBe(10100)
    expect(series[1].equity).toBe(9800)
    expect(series[1].dd).toBe(-300)
    expect(series[2].equity).toBe(9850)
    expect(series[2].dd).toBe(-250)
  })

  it('fills no-trade days with zero P&L', () => {
    const trades = [tradeWithPnl(100, { trade_date: '2026-04-01' })]
    const series = dailyEquitySeries(trades, ['2026-04-01', '2026-04-02'], 0)
    expect(series[0].pnl).toBe(100)
    expect(series[1].pnl).toBe(0)
    expect(series[1].equity).toBe(100)
  })
})

describe('drawdownStats', () => {
  it('computes max drawdown and recovery factor', () => {
    const trades = [
      tradeWithPnl(100, { trade_date: '2026-04-01' }),
      tradeWithPnl(-200, { trade_date: '2026-04-02' }),
      tradeWithPnl(150, { trade_date: '2026-04-03' }),
    ]
    const series = dailyEquitySeries(
      trades,
      ['2026-04-01', '2026-04-02', '2026-04-03'],
      0,
    )
    const stats = drawdownStats(series, 50)
    expect(stats.maxDd).toBe(-200)
    expect(stats.recoveryFactor).toBe(0.25) // 50 / 200
    expect(stats.maxDdDurationDays).toBeGreaterThanOrEqual(1)
  })

  it('returns zeros on empty series', () => {
    const stats = drawdownStats([], 0)
    expect(stats.maxDd).toBe(0)
    expect(stats.recoveryFactor).toBeNull()
  })
})

describe('ratioStats', () => {
  it('returns null on too-short series', () => {
    expect(ratioStats([], 0)).toEqual({
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
      trades.push(tradeWithPnl(i % 3 === 0 ? -50 : 100, { trade_date: d }))
      dates.push(d)
    }
    const series = dailyEquitySeries(trades, dates, 0)
    const stats = ratioStats(series, -0.1)
    expect(Number.isFinite(stats.sharpe!)).toBe(true)
    expect(Number.isFinite(stats.sortino!)).toBe(true)
    expect(Number.isFinite(stats.kRatio!)).toBe(true)
  })
})

describe('rDistribution', () => {
  it('places each trade into one bucket and accumulates', () => {
    // Bucket label convention: +NR is range (N-1, N]; -NR is range (-N, -N+1].
    // So 0.5R wins land in +1R, 1.5R wins in +2R, -0.5R losses in -1R,
    // -1.5R losses in -2R.
    const trades = [
      tradeWithPnl(50, { stop_loss: 100 }), // +0.5R -> +1R
      tradeWithPnl(150, { stop_loss: 100 }), // +1.5R -> +2R
      tradeWithPnl(-50, { stop_loss: 100 }), // -0.5R -> -1R
      tradeWithPnl(-150, { stop_loss: 100 }), // -1.5R -> -2R
      tradeWithPnl(600, { stop_loss: 100 }), // +6R -> 5R+
    ]
    const buckets = rDistribution(trades)
    const get = (label: string) => buckets.find(b => b.label === label)!
    expect(get('+1R').count).toBe(1)
    expect(get('+2R').count).toBe(1)
    expect(get('-1R').count).toBe(1)
    expect(get('-2R').count).toBe(1)
    expect(get('5R+').count).toBe(1)
    // Cumulative ends at total.
    expect(buckets[buckets.length - 1].cumulative).toBe(5)
  })

  it('skips trades without a stop', () => {
    const buckets = rDistribution([tradeWithPnl(100, { stop_loss: 0 })])
    expect(buckets.every(b => b.count === 0)).toBe(true)
  })

  it('skips breakeven (scratch) trades', () => {
    const buckets = rDistribution([
      tradeWithPnl(50, { stop_loss: 100 }),
      tradeWithPnl(0, { stop_loss: 100 }), // scratch — excluded from buckets
    ])
    const total = buckets.reduce((n, b) => n + b.count, 0)
    expect(total).toBe(1)
  })
})

describe('maeMfeStats', () => {
  it('averages drawdown and buildup separately', () => {
    const trades = [
      tradeWithPnl(100, { drawdown: 20, buildup: 200, stop_loss: 100 }),
      tradeWithPnl(-50, { drawdown: 100, buildup: 30, stop_loss: 100 }),
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
    expect(pts[0]).toMatchObject({ x: 20, y: 100, win: true })
    expect(pts[1]).toMatchObject({ x: 100, y: -50, win: false })
  })

  it('mfeScatter skips trades with no buildup', () => {
    const trades = [tradeWithPnl(100, { buildup: 200 }), tradeWithPnl(-50, { buildup: null })]
    expect(mfeScatter(trades)).toHaveLength(1)
  })
})

describe('time-of-day / weekday / month aggregations', () => {
  it('pnlByHour buckets per hour using first execution local time', () => {
    const t = tradeWithPnl(100, {
      executions: [
        execution({ kind: 'buy', time: '2026-04-15T10:30:00.000Z' }),
        execution({ kind: 'sell', time: '2026-04-15T10:45:00.000Z' }),
      ],
    })
    const localHour = new Date('2026-04-15T10:30:00.000Z').getHours()
    const arr = pnlByHour([t])
    expect(arr).toHaveLength(24)
    expect(arr[localHour].count).toBe(1)
    expect(arr[localHour].pnl).toBe(100)
  })

  it('pnlByWeekday counts wins and losses per weekday', () => {
    // April 15 2026 is a Wednesday (day index 3).
    const trades = [
      tradeWithPnl(100, { trade_date: '2026-04-15' }),
      tradeWithPnl(-50, { trade_date: '2026-04-15' }),
    ]
    const arr = pnlByWeekday(trades)
    const wed = arr[3]
    expect(wed.name).toBe('Wed')
    expect(wed.wins).toBe(1)
    expect(wed.losses).toBe(1)
    expect(wed.pnl).toBe(50)
  })

  it('pnlByMonth groups by YYYY-MM', () => {
    const trades = [
      tradeWithPnl(100, { trade_date: '2026-03-31' }),
      tradeWithPnl(50, { trade_date: '2026-04-01' }),
      tradeWithPnl(-25, { trade_date: '2026-04-30' }),
    ]
    const arr = pnlByMonth(trades)
    expect(arr).toEqual([
      { month: '2026-03', pnl: 100, count: 1 },
      { month: '2026-04', pnl: 25, count: 2 },
    ])
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
    })
    expect(score.total).toBeGreaterThanOrEqual(0)
    expect(score.total).toBeLessThanOrEqual(100)
    for (const v of Object.values(score.parts)) {
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
    })
    expect(score.parts.profitFactor).toBe(20) // floor of stepWindow
    expect(score.parts.recovery).toBe(0)
    expect(score.parts.consistency).toBe(0)
  })
})

describe('cohortStats', () => {
  it('summarises a cohort', () => {
    const trades = [
      tradeWithPnl(100, { drawdown: 20, buildup: 200, stop_loss: 100 }),
      tradeWithPnl(50, { drawdown: 30, buildup: 100, stop_loss: 100 }),
    ]
    const s = cohortStats(trades)
    expect(s.count).toBe(2)
    expect(s.avgRr).toBeCloseTo(0.75, 5)
    expect(s.avgMae).toBe(25)
    expect(s.avgMfe).toBe(150)
    expect(s.avgFees).toBeGreaterThan(0)
  })
})
