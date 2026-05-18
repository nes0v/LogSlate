// Deeper analytics on top of `aggregate` — profit factor, expectancy R,
// drawdown timeseries, Sharpe/Sortino/Calmar, K-Ratio, Ulcer, SQN,
// classifyTrade-aware win/loss aggregations.
// streak math, R-multiple distribution, MAE/MFE summaries, and the
// Zella-style composite score. Each function takes plain inputs so it
// stays pure and testable.

import type { TradeRecord } from '@/db/types'
import {
  classifyTrade,
  computeDuration,
  computeFees,
  computeNetPnl,
  computeRealizedRr,
  firstExecutionMs,
  lastExecutionMs,
  tradeMetrics,
  type TradeOutcome,
} from '@/lib/trade-math'
import { dateKeyToDate } from '@/lib/tz'

// ---------- profit factor / payoff / expectancy ---------------------

/** Σ winners / |Σ losers|. Returns Infinity when there are no losers
 *  but at least one winner; null when there's no data. */
export function profitFactor(trades: TradeRecord[]): number | null {
  let wins = 0
  let losses = 0
  for (const t of trades) {
    const { pnl, outcome } = tradeMetrics(t)
    const p = pnl ?? 0
    if (outcome === 'win') wins += p
    else if (outcome === 'loss') losses += p
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
    const { pnl, outcome } = tradeMetrics(t)
    const p = pnl ?? 0
    if (outcome === 'win') {
      ws += p
      wn++
    } else if (outcome === 'loss') {
      ls += p
      ln++
    }
  }
  if (wn === 0 || ln === 0) return null
  return ws / wn / Math.abs(ls / ln)
}

/** Mean R-multiple. R = pnl / stop_loss. Scratch trades
 *  are excluded so the metric reflects decisive trades only. */
export function expectancyR(trades: TradeRecord[]): number | null {
  let n = 0
  let s = 0
  for (const t of trades) {
    if (t.stop_loss <= 0) continue
    const { pnl, outcome } = tradeMetrics(t)
    if (outcome === 'scratch') continue
    s += (pnl ?? 0) / t.stop_loss
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
    const { pnl, outcome } = tradeMetrics(t)
    const p = pnl ?? 0
    if (outcome === 'win') {
      ws += p
      wn++
    } else if (outcome === 'loss') {
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

// ---------- Van Tharp SQN ------------------------------------------

/** System Quality Number = √n × (mean_R / stdev_R). Scratch
 *  trades are excluded so they don't dilute the magnitude. */
export function sqn(trades: TradeRecord[]): number | null {
  const rs: number[] = []
  for (const t of trades) {
    if (t.stop_loss <= 0) continue
    const { pnl, outcome } = tradeMetrics(t)
    if (outcome === 'scratch') continue
    rs.push((pnl ?? 0) / t.stop_loss)
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
  // Order trades by date then first execution time so streaks
  // mean what the user expects (chronological). `id` is the final
  // tie-break — execution times only have second precision, so two
  // scalp entries at the same second would otherwise sort in
  // whatever order Dexie happened to return them.
  const sorted = [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    const tDiff = (firstExecutionMs(a) ?? 0) - (firstExecutionMs(b) ?? 0)
    if (tDiff !== 0) return tDiff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  for (const t of sorted) {
    const outcome = classifyTrade(t)
    const sign = outcome === 'win' ? 1 : outcome === 'loss' ? -1 : 0
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
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + (computeNetPnl(t) ?? 0))
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

  // Tail ratio — averaged-tail formulation (Crittenden / Wilcox):
  // mean of the top 5% over the magnitude of the bottom 5%. The old
  // single-percentile form (|p95| / |p5|) exploded when one near-zero
  // value happened to land at the boundary; averaging at least three
  // samples on each side smooths it. Requires ≥30 daily returns so
  // the tails are statistically meaningful (and to keep tail size
  // proportional rather than swallowing the whole sample on tiny
  // datasets).
  let tailRatio: number | null = null
  if (pnls.length >= 30) {
    const sorted = [...pnls].sort((a, b) => a - b)
    const tailSize = Math.max(3, Math.floor(sorted.length * 0.05))
    const losingTail = sorted.slice(0, tailSize)
    const winningTail = sorted.slice(-tailSize)
    const avgLosingTail =
      losingTail.reduce((a, b) => a + b, 0) / losingTail.length
    const avgWinningTail =
      winningTail.reduce((a, b) => a + b, 0) / winningTail.length
    if (avgLosingTail < 0) {
      tailRatio = Math.abs(avgWinningTail) / Math.abs(avgLosingTail)
    }
  }

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
  // Edges are centered on integer R values with ±0.5R half-bins so the
  // label matches what the user reads: a loss of 1.05R (slippage past
  // stop, fees) belongs in the `-1R` bucket, not `-2R`. `-1R` is
  // widened all the way to 0 to absorb small losses (and `+1R` to 0
  // for small wins), since R-multiples below ±0.5 still represent the
  // "near-stop" outcome class.
  const edges: Array<[number, number, string]> = [
    [-Infinity, -5.5, '< -5R'],
    [-5.5, -4.5, '-5R'],
    [-4.5, -3.5, '-4R'],
    [-3.5, -2.5, '-3R'],
    [-2.5, -1.5, '-2R'],
    [-1.5, 0, '-1R'],
    [0, 1.5, '+1R'],
    [1.5, 2.5, '+2R'],
    [2.5, 3.5, '+3R'],
    [3.5, 4.5, '+4R'],
    [4.5, 5.5, '+5R'],
    [5.5, Infinity, '5R+'],
  ]
  const buckets: RBucket[] = edges.map(([lo, hi, label]) => ({
    label,
    range: [lo, hi],
    count: 0,
    cumulative: 0,
  }))
  for (const t of trades) {
    if (t.stop_loss <= 0) continue
    const { pnl, outcome } = tradeMetrics(t)
    if (outcome === 'scratch') continue
    const r = (pnl ?? 0) / t.stop_loss
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
    if (t.drawdown !== null && t.drawdown > 0) {
      mae += t.drawdown
      nMae++
    }
    if (t.buildup !== null && t.buildup > 0) {
      mfe += t.buildup
      nMfe++
    }
    const { pnl: p, outcome } = tradeMetrics(t)
    const pnl = p ?? 0
    if (outcome === 'win' && t.buildup !== null && t.buildup > 0) {
      effSum += pnl / t.buildup
      effN++
    }
    if (outcome === 'loss' && t.drawdown !== null && t.drawdown > 0 && t.stop_loss > 0) {
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
  /** Kept for back-compat — true only for trades classified as a win
   *  (i.e. above the AHPC threshold and with positive PnL). */
  win: boolean
  outcome: TradeOutcome
  date: string
}

export function maeScatter(trades: TradeRecord[]): ScatterPoint[] {
  const out: ScatterPoint[] = []
  for (const t of trades) {
    const { pnl, outcome } = tradeMetrics(t)
    if (pnl === null) continue
    if (t.drawdown === null) continue
    out.push({
      id: t.id,
      x: t.drawdown,
      y: pnl,
      win: outcome === 'win',
      outcome,
      date: t.date,
    })
  }
  return out
}

export function mfeScatter(trades: TradeRecord[]): ScatterPoint[] {
  const out: ScatterPoint[] = []
  for (const t of trades) {
    const { pnl, outcome } = tradeMetrics(t)
    if (pnl === null) continue
    if (t.buildup === null) continue
    out.push({
      id: t.id,
      x: t.buildup,
      y: pnl,
      win: outcome === 'win',
      outcome,
      date: t.date,
    })
  }
  return out
}

// ---------- time-of-day / day-of-week / monthly ------------

const HOUR_BUCKETS = 24

export type HourMode = 'first' | 'last'

export function pnlByHour(
  trades: TradeRecord[],
  mode: HourMode = 'first',
): Array<{ hour: number; pnl: number; count: number; wins: number; losses: number }> {
  const arr = Array.from({ length: HOUR_BUCKETS }, (_, h) => ({
    hour: h,
    pnl: 0,
    count: 0,
    wins: 0,
    losses: 0,
  }))
  const pickMs = mode === 'last' ? lastExecutionMs : firstExecutionMs
  for (const t of trades) {
    const ms = pickMs(t)
    if (ms === null) continue
    // Execution times are stored as `${date}T${HH:MM:SS}.000Z` literals —
    // the typed NY wallclock encoded as a fictional UTC. `getUTCHours()`
    // pulls the typed hour back out without any tz math.
    const h = new Date(ms).getUTCHours()
    const { pnl, outcome } = tradeMetrics(t)
    arr[h].pnl += pnl ?? 0
    arr[h].count++
    if (outcome === 'win') arr[h].wins++
    else if (outcome === 'loss') arr[h].losses++
  }
  return arr
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function pnlByWeekday(trades: TradeRecord[]): Array<{ name: string; pnl: number; count: number; wins: number; losses: number }> {
  const arr = WEEKDAYS.map(name => ({ name, pnl: 0, count: 0, wins: 0, losses: 0 }))
  for (const t of trades) {
    const day = dateKeyToDate(t.date).getDay()
    const { pnl, outcome } = tradeMetrics(t)
    arr[day].pnl += pnl ?? 0
    arr[day].count++
    if (outcome === 'win') arr[day].wins++
    else if (outcome === 'loss') arr[day].losses++
  }
  return arr
}

/** P&L grouped by ISO week (Mon..Sun). The label is the week's Monday
 *  in `YYYY-MM-DD` form so it sorts naturally and is unambiguous across
 *  year boundaries. */
export function pnlByWeek(
  trades: TradeRecord[],
): Array<{ weekStart: string; pnl: number; count: number; wins: number; losses: number }> {
  const m = new Map<string, { pnl: number; count: number; wins: number; losses: number }>()
  for (const t of trades) {
    const d = dateKeyToDate(t.date)
    // Shift to Monday: getDay() returns 0..6 with 0 = Sunday.
    const dow = d.getDay()
    const offset = dow === 0 ? -6 : 1 - dow
    const monday = new Date(d)
    monday.setDate(d.getDate() + offset)
    const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
    const cur = m.get(key) ?? { pnl: 0, count: 0, wins: 0, losses: 0 }
    const { pnl, outcome } = tradeMetrics(t)
    cur.pnl += pnl ?? 0
    cur.count++
    if (outcome === 'win') cur.wins++
    else if (outcome === 'loss') cur.losses++
    m.set(key, cur)
  }
  return Array.from(m.entries())
    .map(([weekStart, v]) => ({ weekStart, ...v }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
}

/** P&L grouped by `YYYY-MM` (calendar month). */
export function pnlByMonth(trades: TradeRecord[]): Array<{ month: string; pnl: number; count: number }> {
  const m = new Map<string, { pnl: number; count: number }>()
  for (const t of trades) {
    const ym = t.date.slice(0, 7)
    const cur = m.get(ym) ?? { pnl: 0, count: 0 }
    cur.pnl += computeNetPnl(t) ?? 0
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
    const outcome = classifyTrade(t)
    if (outcome === 'win') out[idx].wins++
    else if (outcome === 'loss') out[idx].losses++
  }
  return out
}

// ---------- Zella-style composite score ----------------------------

/** 0–100 score with sub-components. Replicates the public TradeZella
 *  formula from their help-center: PF 25%, Avg Win/Loss 20%, Max DD 20%,
 *  Win % 15%, Recovery 10%, Consistency 10%.
 *
 *  `consistency` is `null` when it can't be measured (fewer than two
 *  trading days in the window — stdev needs ≥2 samples). In that case
 *  the remaining 5 components share the full 100 weight pro-rata
 *  rather than docking the score by 10 for missing data. */
export interface CompositeScore {
  total: number
  parts: {
    profitFactor: number
    payoff: number
    maxDd: number
    winRate: number
    recovery: number
    consistency: number | null
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
  wins: number
  losses: number
}): CompositeScore {
  // Each sub-score is 0..100.
  const stepWindow = (v: number | null, lo: number, hi: number): number => {
    if (v === null || !isFinite(v)) return 0
    if (v <= lo) return 20
    if (v >= hi) return 100
    return 20 + ((v - lo) / (hi - lo)) * 80
  }
  // PF / payoff "no losers" handling. Without this, a pure-winners
  // window (losses === 0) returns Infinity / null from the underlying
  // formulas and stepWindow maps both to 0 — penalising the strongest
  // possible outcome. Treat as the ceiling instead.
  const hasWinners = args.wins > 0
  const noLosers = args.losses === 0
  const profitFactor =
    hasWinners && noLosers ? 100 : stepWindow(args.profitFactor, 1.0, 2.6)
  const payoff =
    hasWinners && noLosers ? 100 : stepWindow(args.payoff, 1.0, 2.6)
  const winRate = args.winRate === null ? 0 : Math.min(100, (args.winRate / 0.6) * 100)
  // max DD score: 0% loss -> 100, 100% loss -> 0.
  const maxDd = Math.max(0, Math.min(100, 100 - Math.abs(args.maxDdPct) * 100))
  // Recovery: <1.0 -> 0, 3.5+ -> 100, linear in between. A zero-drawdown
  // window with positive PnL is a perfect drawdown record (recovery is
  // mathematically infinite); treat as the ceiling rather than 0.
  const noDrawdown = args.maxDdPct === 0
  const recovery =
    noDrawdown && args.netPnl > 0
      ? 100
      : args.recoveryFactor === null || !isFinite(args.recoveryFactor)
        ? 0
        : args.recoveryFactor <= 1
          ? 0
          : args.recoveryFactor >= 3.5
            ? 100
            : ((args.recoveryFactor - 1) / 2.5) * 100
  // Consistency: 100 - (stdev_daily / total_profit). Undefined (null)
  // when there's fewer than two trading days — stdev needs ≥2 samples.
  // The total then reweights the remaining components pro-rata so a
  // single-day window isn't artificially docked 10 points for a
  // metric that simply can't be computed.
  let consistency: number | null = null
  if (args.dailyPnls.length >= 2) {
    if (args.netPnl <= 0) {
      consistency = 0
    } else {
      const m = args.dailyPnls.reduce((a, b) => a + b, 0) / args.dailyPnls.length
      const v =
        args.dailyPnls.reduce((a, b) => a + (b - m) ** 2, 0) /
        (args.dailyPnls.length - 1)
      const sd = Math.sqrt(v)
      consistency = Math.max(0, Math.min(100, 100 - (sd / args.netPnl) * 100))
    }
  }
  let total =
    profitFactor * 0.25 +
    payoff * 0.2 +
    maxDd * 0.2 +
    winRate * 0.15 +
    recovery * 0.1
  if (consistency !== null) total += consistency * 0.1
  else total /= 0.9 // reweight the remaining five from 90% → 100%
  return {
    total,
    parts: { profitFactor, payoff, maxDd, winRate, recovery, consistency },
  }
}

// ---------- per-trade extremes & day-level summary -----------------

export interface ExtremeStats {
  largestWin: number | null // most positive single-trade pnl
  largestLoss: number | null // most negative single-trade pnl
}

export function extremeStats(trades: TradeRecord[]): ExtremeStats {
  let largestWin: number | null = null
  let largestLoss: number | null = null
  for (const t of trades) {
    const pnl = computeNetPnl(t)
    if (pnl === null) continue
    if (pnl > 0 && (largestWin === null || pnl > largestWin)) largestWin = pnl
    if (pnl < 0 && (largestLoss === null || pnl < largestLoss)) largestLoss = pnl
  }
  return { largestWin, largestLoss }
}

export interface DailyStats {
  bestDay: number | null
  worstDay: number | null
  avgDailyPnl: number | null
  /** Days with positive PnL ÷ days that had trades. */
  dayWinRate: number | null
  greenDays: number
  redDays: number
  scratchDays: number
}

// A day whose absolute pnl is within this fraction of start-of-day equity
// counts as a scratch even if pnl ≠ 0 — small chops on top of a real
// account shouldn't tip the day into the green/red bucket. A hard
// floor keeps tiny accounts (where 0.4% rounds to pennies) from going
// green/red on a few dollars of slippage.
export const SCRATCH_DAY_PCT = 0.004
export const SCRATCH_DAY_MIN_USD = 8

export function classifyDayPnl(
  pnl: number,
  startEquity: number,
): 'win' | 'loss' | 'scratch' {
  const band = Math.max(startEquity * SCRATCH_DAY_PCT, SCRATCH_DAY_MIN_USD)
  if (Math.abs(pnl) <= band) return 'scratch'
  if (pnl > 0) return 'win'
  if (pnl < 0) return 'loss'
  return 'scratch'
}

/** Aggregates the equity series down to per-trading-day metrics. Only
 *  days with at least one trade count toward the rates and average.
 *  `accountStartEquity` is the real account equity right before the first
 *  day of the series — needed so the ±0.4% scratch band uses real capital
 *  rather than period-relative PnL.
 *
 *  `adjustmentsByDate` (optional) lets the running-equity walk track
 *  mid-period deposits/withdrawals so the per-day scratch threshold
 *  reflects real capital throughout the range, not just at its start.
 *  Without it, a $5k mid-period deposit doesn't lift the threshold, so
 *  some near-threshold days can be misclassified as wins/losses instead
 *  of scratches. */
export function dailyStats(
  series: EquityPoint[],
  accountStartEquity = 0,
  adjustmentsByDate?: Map<string, number>,
): DailyStats {
  const tradingDays = series.filter(p => p.pnl !== 0)
  if (tradingDays.length === 0) {
    return {
      bestDay: null,
      worstDay: null,
      avgDailyPnl: null,
      dayWinRate: null,
      greenDays: 0,
      redDays: 0,
      scratchDays: 0,
    }
  }
  let best = -Infinity
  let worst = Infinity
  let green = 0
  let red = 0
  let even = 0
  let total = 0
  let runningEquity = accountStartEquity
  for (const p of series) {
    if (p.pnl !== 0) {
      if (p.pnl > best) best = p.pnl
      if (p.pnl < worst) worst = p.pnl
      const outcome = classifyDayPnl(p.pnl, runningEquity)
      if (outcome === 'win') green++
      else if (outcome === 'loss') red++
      else even++
      total += p.pnl
    }
    runningEquity += p.pnl + (adjustmentsByDate?.get(p.date) ?? 0)
  }
  const decided = green + red
  return {
    bestDay: best,
    worstDay: worst,
    avgDailyPnl: total / tradingDays.length,
    dayWinRate: decided > 0 ? green / decided : null,
    greenDays: green,
    redDays: red,
    scratchDays: even,
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
    const dur = computeDuration(t)
    if (dur.total_ms !== null) {
      dSum += dur.total_ms
      dN++
    }
    if (t.drawdown !== null && t.drawdown > 0) {
      maeSum += t.drawdown
      maeN++
    }
    if (t.buildup !== null && t.buildup > 0) {
      mfeSum += t.buildup
      mfeN++
    }
    feeSum += computeFees(t)
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
