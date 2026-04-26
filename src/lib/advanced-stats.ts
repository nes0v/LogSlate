// Deeper analytics on top of `aggregate` — profit factor, expectancy R,
// drawdown timeseries, Sharpe/Sortino/Calmar, K-Ratio, Ulcer, SQN,
// streak math, R-multiple distribution, MAE/MFE summaries, and the
// Zella-style composite score. Each function takes plain inputs so it
// stays pure and testable.

import type { TradeRecord } from '@/db/types'
import { computeRealizedRr, effectivePnl } from '@/lib/trade-math'

// ---------- profit factor / payoff / expectancy ---------------------

/** Σ winners / |Σ losers|. Returns Infinity when there are no losers
 *  but at least one winner; null when there's no data. */
export function profitFactor(trades: TradeRecord[]): number | null {
  let wins = 0
  let losses = 0
  for (const t of trades) {
    const p = effectivePnl(t) ?? 0
    if (p > 0) wins += p
    else if (p < 0) losses += p
  }
  if (wins === 0 && losses === 0) return null
  if (losses === 0) return Infinity
  return wins / Math.abs(losses)
}

/** avg_win / |avg_loss|. */
export function payoffRatio(trades: TradeRecord[]): number | null {
  let wn = 0
  let ws = 0
  let ln = 0
  let ls = 0
  for (const t of trades) {
    const p = effectivePnl(t) ?? 0
    if (p > 0) {
      ws += p
      wn++
    } else if (p < 0) {
      ls += p
      ln++
    }
  }
  if (wn === 0 || ln === 0) return null
  return ws / wn / Math.abs(ls / ln)
}

/** Mean R-multiple. R = pnl / stop_loss. */
export function expectancyR(trades: TradeRecord[]): number | null {
  let n = 0
  let s = 0
  for (const t of trades) {
    if (t.stop_loss <= 0) continue
    s += (effectivePnl(t) ?? 0) / t.stop_loss
    n++
  }
  return n > 0 ? s / n : null
}

/** $ per trade on average — (win% * avg_win) - (loss% * |avg_loss|). */
export function expectancyDollars(trades: TradeRecord[]): number | null {
  if (trades.length === 0) return null
  let wn = 0
  let ws = 0
  let ln = 0
  let ls = 0
  for (const t of trades) {
    const p = effectivePnl(t) ?? 0
    if (p > 0) {
      ws += p
      wn++
    } else if (p < 0) {
      ls += p
      ln++
    }
  }
  const decided = wn + ln
  if (decided === 0) return null
  const wr = wn / decided
  const lr = ln / decided
  const avgWin = wn > 0 ? ws / wn : 0
  const avgLoss = ln > 0 ? ls / ln : 0
  return wr * avgWin + lr * avgLoss
}

/** Kelly fraction: win% - (loss% / payoff). Capped to [0, 1]. */
export function kellyFraction(trades: TradeRecord[]): number | null {
  const pf = payoffRatio(trades)
  if (pf === null) return null
  let wn = 0
  let ln = 0
  for (const t of trades) {
    const p = effectivePnl(t) ?? 0
    if (p > 0) wn++
    else if (p < 0) ln++
  }
  const decided = wn + ln
  if (decided === 0) return null
  const wr = wn / decided
  const lr = ln / decided
  const k = wr - lr / pf
  return Math.max(0, Math.min(1, k))
}

// ---------- Van Tharp SQN ------------------------------------------

/** System Quality Number = √n × (mean_R / stdev_R). */
export function sqn(trades: TradeRecord[]): number | null {
  const rs: number[] = []
  for (const t of trades) {
    if (t.stop_loss <= 0) continue
    rs.push((effectivePnl(t) ?? 0) / t.stop_loss)
  }
  if (rs.length < 2) return null
  const m = rs.reduce((a, b) => a + b, 0) / rs.length
  const v = rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1)
  const sd = Math.sqrt(v)
  if (sd === 0) return null
  return Math.sqrt(rs.length) * (m / sd)
}

// ---------- streaks -------------------------------------------------

export interface StreakStats {
  longestWin: number
  longestLoss: number
  current: number // signed: +N for ongoing winning streak, -N for losing
}

export function streakStats(trades: TradeRecord[]): StreakStats {
  let longestWin = 0
  let longestLoss = 0
  let current = 0
  let curSign = 0
  // Order trades by trade_date then first execution time so streaks
  // mean what the user expects (chronological).
  const sorted = [...trades].sort((a, b) => {
    if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? -1 : 1
    return firstExecMs(a) - firstExecMs(b)
  })
  for (const t of sorted) {
    const p = effectivePnl(t) ?? 0
    const sign = p > 0 ? 1 : p < 0 ? -1 : 0
    if (sign === 0) {
      // Scratch — break streak.
      curSign = 0
      current = 0
      continue
    }
    if (sign === curSign) {
      current += 1 * sign
    } else {
      curSign = sign
      current = sign
    }
    if (current > longestWin) longestWin = current
    if (-current > longestLoss) longestLoss = -current
  }
  return { longestWin, longestLoss, current }
}

function firstExecMs(t: TradeRecord): number {
  let min = Infinity
  for (const e of t.executions) {
    const ms = Date.parse(e.time)
    if (!Number.isNaN(ms) && ms < min) min = ms
  }
  return min === Infinity ? 0 : min
}

// ---------- per-day series + drawdown ------------------------------

export interface EquityPoint {
  date: string // YYYY-MM-DD
  pnl: number // net PnL on this day (trades only, excludes adjustments)
  equity: number // cumulative starting from `startEquity`
  peak: number // running max equity to date
  dd: number // equity - peak (≤ 0)
  ddPct: number // dd / peak
}

/** Builds a per-day equity timeseries. `dates` is the inclusive list
 *  of trading days to include (so streaks and underwater plots are
 *  continuous even on no-trade days). */
export function dailyEquitySeries(
  trades: TradeRecord[],
  dates: string[],
  startEquity = 0,
): EquityPoint[] {
  const byDay = new Map<string, number>()
  for (const t of trades) {
    byDay.set(t.trade_date, (byDay.get(t.trade_date) ?? 0) + (effectivePnl(t) ?? 0))
  }
  let equity = startEquity
  let peak = startEquity
  return dates.map(d => {
    const pnl = byDay.get(d) ?? 0
    equity += pnl
    if (equity > peak) peak = equity
    const dd = equity - peak
    const ddPct = peak > 0 ? dd / peak : 0
    return { date: d, pnl, equity, peak, dd, ddPct }
  })
}

export interface DrawdownStats {
  maxDd: number // worst (most negative) dd $ value, ≤ 0
  maxDdPct: number // worst dd %, ≤ 0
  maxDdDurationDays: number // longest stretch without a new equity high
  avgDdDurationDays: number // mean drawdown stretch (excluding zero-length)
  recoveryFactor: number | null // net pnl / |maxDd|
  ulcerIndex: number // sqrt(mean(squared % drawdowns)), in % units (0..100)
  upi: number | null // CAGR-proxy / Ulcer Index — uses mean daily pnl, not annualised
}

export function drawdownStats(series: EquityPoint[], netPnl: number): DrawdownStats {
  if (series.length === 0) {
    return {
      maxDd: 0,
      maxDdPct: 0,
      maxDdDurationDays: 0,
      avgDdDurationDays: 0,
      recoveryFactor: null,
      ulcerIndex: 0,
      upi: null,
    }
  }
  let maxDd = 0
  let maxDdPct = 0
  let curStreak = 0
  let maxStreak = 0
  const streaks: number[] = []
  let sqDdSum = 0
  for (const p of series) {
    if (p.dd < maxDd) maxDd = p.dd
    if (p.ddPct < maxDdPct) maxDdPct = p.ddPct
    if (p.dd < 0) {
      curStreak++
      if (curStreak > maxStreak) maxStreak = curStreak
    } else {
      if (curStreak > 0) streaks.push(curStreak)
      curStreak = 0
    }
    sqDdSum += (p.ddPct * 100) ** 2
  }
  if (curStreak > 0) streaks.push(curStreak)
  const avgStreak = streaks.length > 0
    ? streaks.reduce((a, b) => a + b, 0) / streaks.length
    : 0
  const ulcer = Math.sqrt(sqDdSum / series.length)
  const recoveryFactor = maxDd < 0 ? netPnl / Math.abs(maxDd) : null
  const meanPnl = series.reduce((a, b) => a + b.pnl, 0) / series.length
  const upi = ulcer > 0 ? meanPnl / ulcer : null
  return {
    maxDd,
    maxDdPct,
    maxDdDurationDays: maxStreak,
    avgDdDurationDays: avgStreak,
    recoveryFactor,
    ulcerIndex: ulcer,
    upi,
  }
}

// ---------- ratios over daily returns -------------------------------

export interface RatioStats {
  sharpe: number | null
  sortino: number | null
  calmar: number | null
  kRatio: number | null
  tailRatio: number | null
}

export function ratioStats(series: EquityPoint[], maxDdPct: number): RatioStats {
  if (series.length < 2) {
    return { sharpe: null, sortino: null, calmar: null, kRatio: null, tailRatio: null }
  }
  const pnls = series.map(p => p.pnl)
  const m = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const v = pnls.reduce((a, b) => a + (b - m) ** 2, 0) / (pnls.length - 1)
  const sd = Math.sqrt(v)
  const sharpe = sd > 0 ? (m / sd) * Math.sqrt(252) : null

  let sortino: number | null = null
  const downside = pnls.filter(p => p < 0)
  if (downside.length > 0) {
    const dv = downside.reduce((a, b) => a + b * b, 0) / downside.length
    const dsd = Math.sqrt(dv)
    sortino = dsd > 0 ? (m / dsd) * Math.sqrt(252) : null
  }

  // Calmar — annualised return / |max DD %|. Approx. annualised by
  // mean_daily * 252 / starting_equity, but we don't track starting
  // equity here, so use mean_daily * 252 / |max_dd_$| as a scale-free
  // analogue. When max_dd is 0, Calmar is undefined.
  const lastEquity = series[series.length - 1].equity
  const cagrLike = m * 252
  const maxDd = series.reduce((a, b) => Math.min(a, b.dd), 0)
  const calmar = maxDd < 0 ? cagrLike / Math.abs(maxDd) : null
  void maxDdPct // legacy signature; calmar uses $ form here for stability
  void lastEquity

  // K-Ratio (simplified) — slope of cumulative-return regression
  // divided by its standard error, scaled by √n. Equity is already
  // cumulative so we regress equity_i vs i.
  let kRatio: number | null = null
  if (series.length >= 5) {
    const xs = series.map((_, i) => i)
    const ys = series.map(p => p.equity)
    const n = xs.length
    const sumX = xs.reduce((a, b) => a + b, 0)
    const sumY = ys.reduce((a, b) => a + b, 0)
    const meanX = sumX / n
    const meanY = sumY / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY)
      den += (xs[i] - meanX) ** 2
    }
    const slope = den > 0 ? num / den : 0
    const intercept = meanY - slope * meanX
    let sse = 0
    for (let i = 0; i < n; i++) {
      const yhat = intercept + slope * xs[i]
      sse += (ys[i] - yhat) ** 2
    }
    const stderrSlope = den > 0 && n > 2 ? Math.sqrt(sse / (n - 2) / den) : 0
    if (stderrSlope > 0) kRatio = (slope / stderrSlope) / Math.sqrt(n)
  }

  // Tail ratio — |95th percentile| / |5th percentile|.
  const sorted = [...pnls].sort((a, b) => a - b)
  const p5 = sorted[Math.floor(sorted.length * 0.05)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const tailRatio = p5 < 0 ? Math.abs(p95) / Math.abs(p5) : null

  return { sharpe, sortino, calmar, kRatio, tailRatio }
}

// ---------- R-multiple distribution -------------------------------

export interface RBucket {
  label: string
  range: [number, number]
  count: number
  cumulative: number
}

export function rDistribution(trades: TradeRecord[]): RBucket[] {
  const edges: Array<[number, number, string]> = [
    [-Infinity, -3, '< -3R'],
    [-3, -2, '-3R'],
    [-2, -1, '-2R'],
    [-1, 0, '-1R'],
    [0, 1, '+1R'],
    [1, 2, '+2R'],
    [2, 3, '+3R'],
    [3, 4, '+4R'],
    [4, 5, '+5R'],
    [5, Infinity, '5R+'],
  ]
  const buckets: RBucket[] = edges.map(([lo, hi, label]) => ({
    label,
    range: [lo, hi],
    count: 0,
    cumulative: 0,
  }))
  for (const t of trades) {
    if (t.stop_loss <= 0) continue
    const r = (effectivePnl(t) ?? 0) / t.stop_loss
    for (const b of buckets) {
      if (r > b.range[0] && r <= b.range[1]) {
        b.count++
        break
      }
    }
  }
  let cum = 0
  for (const b of buckets) {
    cum += b.count
    b.cumulative = cum
  }
  return buckets
}

// ---------- MAE / MFE / efficiency --------------------------------

export interface MaeMfeStats {
  avgMae: number | null
  avgMfe: number | null
  /** Winning trades only: mean of (pnl / MFE). 1.0 = held to peak;
   *  lower = gave back. */
  mfeEfficiency: number | null
  /** Mean of MAE/stop ratio across losers — 1.0 means losers ran to
   *  full stop on average. */
  maeStopRatio: number | null
}

export function maeMfeStats(trades: TradeRecord[]): MaeMfeStats {
  let mae = 0
  let nMae = 0
  let mfe = 0
  let nMfe = 0
  let effSum = 0
  let effN = 0
  let maeStopSum = 0
  let maeStopN = 0
  for (const t of trades) {
    if (t.drawdown > 0) {
      mae += t.drawdown
      nMae++
    }
    if (t.buildup !== null && t.buildup > 0) {
      mfe += t.buildup
      nMfe++
    }
    const pnl = effectivePnl(t) ?? 0
    if (pnl > 0 && t.buildup !== null && t.buildup > 0) {
      effSum += pnl / t.buildup
      effN++
    }
    if (pnl < 0 && t.drawdown > 0 && t.stop_loss > 0) {
      maeStopSum += t.drawdown / t.stop_loss
      maeStopN++
    }
  }
  return {
    avgMae: nMae > 0 ? mae / nMae : null,
    avgMfe: nMfe > 0 ? mfe / nMfe : null,
    mfeEfficiency: effN > 0 ? effSum / effN : null,
    maeStopRatio: maeStopN > 0 ? maeStopSum / maeStopN : null,
  }
}

// ---------- per-trade scatter points (MAE/MFE plots) ------------

export interface ScatterPoint {
  id: string
  x: number
  y: number
  win: boolean
  date: string
}

export function maeScatter(trades: TradeRecord[]): ScatterPoint[] {
  const out: ScatterPoint[] = []
  for (const t of trades) {
    const p = effectivePnl(t)
    if (p === null) continue
    out.push({
      id: t.id,
      x: t.drawdown,
      y: p,
      win: p > 0,
      date: t.trade_date,
    })
  }
  return out
}

export function mfeScatter(trades: TradeRecord[]): ScatterPoint[] {
  const out: ScatterPoint[] = []
  for (const t of trades) {
    const p = effectivePnl(t)
    if (p === null) continue
    if (t.buildup === null) continue
    out.push({
      id: t.id,
      x: t.buildup,
      y: p,
      win: p > 0,
      date: t.trade_date,
    })
  }
  return out
}

// ---------- time-of-day / day-of-week / monthly ------------

const HOUR_BUCKETS = 24

export function pnlByHour(trades: TradeRecord[]): Array<{ hour: number; pnl: number; count: number }> {
  const arr = Array.from({ length: HOUR_BUCKETS }, (_, h) => ({ hour: h, pnl: 0, count: 0 }))
  for (const t of trades) {
    const ms = firstExecMs(t)
    if (!ms) continue
    const h = new Date(ms).getHours()
    arr[h].pnl += effectivePnl(t) ?? 0
    arr[h].count++
  }
  return arr
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function pnlByWeekday(trades: TradeRecord[]): Array<{ name: string; pnl: number; count: number; wins: number; losses: number }> {
  const arr = WEEKDAYS.map(name => ({ name, pnl: 0, count: 0, wins: 0, losses: 0 }))
  for (const t of trades) {
    const day = new Date(t.trade_date + 'T00:00:00').getDay()
    const p = effectivePnl(t) ?? 0
    arr[day].pnl += p
    arr[day].count++
    if (p > 0) arr[day].wins++
    else if (p < 0) arr[day].losses++
  }
  return arr
}

/** P&L grouped by `YYYY-MM` (calendar month). */
export function pnlByMonth(trades: TradeRecord[]): Array<{ month: string; pnl: number; count: number }> {
  const m = new Map<string, { pnl: number; count: number }>()
  for (const t of trades) {
    const ym = t.trade_date.slice(0, 7)
    const cur = m.get(ym) ?? { pnl: 0, count: 0 }
    cur.pnl += effectivePnl(t) ?? 0
    cur.count++
    m.set(ym, cur)
  }
  return Array.from(m.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => (a.month < b.month ? -1 : 1))
}

// ---------- hold-time histogram ------------------------------------

const HOLD_EDGES_MIN: Array<[number, number, string]> = [
  [0, 1, '<1m'],
  [1, 5, '1-5m'],
  [5, 15, '5-15m'],
  [15, 30, '15-30m'],
  [30, 60, '30-60m'],
  [60, 120, '1-2h'],
  [120, 240, '2-4h'],
  [240, Infinity, '4h+'],
]
export function holdTimeBuckets(trades: TradeRecord[]): Array<{ label: string; wins: number; losses: number }> {
  const out = HOLD_EDGES_MIN.map(([, , label]) => ({ label, wins: 0, losses: 0 }))
  for (const t of trades) {
    const times = t.executions.map(e => Date.parse(e.time)).filter(n => !Number.isNaN(n))
    if (times.length < 2) continue
    const minutes = (Math.max(...times) - Math.min(...times)) / 60000
    const idx = HOLD_EDGES_MIN.findIndex(([lo, hi]) => minutes >= lo && minutes < hi)
    if (idx < 0) continue
    const p = effectivePnl(t) ?? 0
    if (p > 0) out[idx].wins++
    else if (p < 0) out[idx].losses++
  }
  return out
}

// ---------- Zella-style composite score ----------------------------

/** 0–100 score with sub-components. Replicates the public TradeZella
 *  formula from their help-center: PF 25%, Avg Win/Loss 20%, Max DD 20%,
 *  Win % 15%, Recovery 10%, Consistency 10%. */
export interface CompositeScore {
  total: number
  parts: {
    profitFactor: number
    payoff: number
    maxDd: number
    winRate: number
    recovery: number
    consistency: number
  }
}

export function compositeScore(args: {
  profitFactor: number | null
  payoff: number | null
  winRate: number | null
  maxDdPct: number // ≤ 0
  recoveryFactor: number | null
  dailyPnls: number[]
  netPnl: number
}): CompositeScore {
  // Each sub-score is 0..100.
  const stepWindow = (v: number | null, lo: number, hi: number): number => {
    if (v === null || !isFinite(v)) return 0
    if (v <= lo) return 20
    if (v >= hi) return 100
    return 20 + ((v - lo) / (hi - lo)) * 80
  }
  const profitFactor = stepWindow(args.profitFactor, 1.0, 2.6)
  const payoff = stepWindow(args.payoff, 1.0, 2.6)
  const winRate = args.winRate === null ? 0 : Math.min(100, (args.winRate / 0.6) * 100)
  // max DD score: 0% loss -> 100, 100% loss -> 0.
  const maxDd = Math.max(0, Math.min(100, 100 - Math.abs(args.maxDdPct) * 100))
  // Recovery: <1.0 -> 0, 3.5+ -> 100, linear in between.
  const recovery =
    args.recoveryFactor === null || !isFinite(args.recoveryFactor)
      ? 0
      : args.recoveryFactor <= 1
        ? 0
        : args.recoveryFactor >= 3.5
          ? 100
          : ((args.recoveryFactor - 1) / 2.5) * 100
  // Consistency: 100 - (stdev_daily / total_profit). 0 if total_profit ≤ 0.
  let consistency = 0
  if (args.netPnl > 0 && args.dailyPnls.length >= 2) {
    const m = args.dailyPnls.reduce((a, b) => a + b, 0) / args.dailyPnls.length
    const v =
      args.dailyPnls.reduce((a, b) => a + (b - m) ** 2, 0) /
      (args.dailyPnls.length - 1)
    const sd = Math.sqrt(v)
    consistency = Math.max(0, Math.min(100, 100 - (sd / args.netPnl) * 100))
  }
  const total =
    profitFactor * 0.25 +
    payoff * 0.2 +
    maxDd * 0.2 +
    winRate * 0.15 +
    recovery * 0.1 +
    consistency * 0.1
  return {
    total,
    parts: { profitFactor, payoff, maxDd, winRate, recovery, consistency },
  }
}

// ---------- compare cohorts (wins vs losses, e.g.) ---------------

export interface CohortCompare {
  count: number
  avgRr: number | null
  avgDuration_ms: number | null
  avgMae: number | null
  avgMfe: number | null
  avgFees: number
}

export function cohortStats(trades: TradeRecord[]): CohortCompare {
  let rrSum = 0
  let rrN = 0
  let dSum = 0
  let dN = 0
  let maeSum = 0
  let maeN = 0
  let mfeSum = 0
  let mfeN = 0
  let feeSum = 0
  for (const t of trades) {
    const rr = computeRealizedRr(t)
    if (rr !== null) {
      rrSum += rr
      rrN++
    }
    const ms = t.executions.map(e => Date.parse(e.time)).filter(n => !Number.isNaN(n))
    if (ms.length >= 2) {
      dSum += Math.max(...ms) - Math.min(...ms)
      dN++
    }
    if (t.drawdown > 0) {
      maeSum += t.drawdown
      maeN++
    }
    if (t.buildup !== null && t.buildup > 0) {
      mfeSum += t.buildup
      mfeN++
    }
    feeSum += t.executions.length * (t.contract_type === 'micro' ? 0.62 : 2.25)
  }
  return {
    count: trades.length,
    avgRr: rrN > 0 ? rrSum / rrN : null,
    avgDuration_ms: dN > 0 ? dSum / dN : null,
    avgMae: maeN > 0 ? maeSum / maeN : null,
    avgMfe: mfeN > 0 ? mfeSum / mfeN : null,
    avgFees: trades.length > 0 ? feeSum / trades.length : 0,
  }
}
