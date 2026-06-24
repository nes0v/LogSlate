import { addDays, format } from 'date-fns'
import type { EquityAdjustment, TradeRecord } from '@/db/types'
import type { Bucket } from '@/lib/buckets'
import { dateKeyToDate } from '@/lib/tz'
import {
  classifyTrade,
  computeDuration,
  computeFees,
  computeGrossPnl,
  computePlannedRr,
  computeRealizedRr,
  computeNetPnl,
  firstExecutionMs,
} from '@/lib/trade-math'

export function signedAdjustment(a: EquityAdjustment): number {
  switch (a.kind) {
    case 'deposit':
      return a.amount
    case 'withdraw':
    case 'fee':
      return -a.amount
  }
}

export interface AggregateStats {
  count: number
  net_pnl: number
  gross_pnl: number
  fees: number
  wins: number
  losses: number
  scratches: number
  win_rate: number | null // 0–1, excluding scratches from denominator
  best: number | null
  worst: number | null
  avg_planned_rr: number | null
  avg_realized_rr: number | null
  avg_risk: number | null // average stop_loss USD across trades with a defined stop
  avg_win: number | null // average net PNL of winning trades (positive)
  avg_loss: number | null // average net PNL of losing trades (negative)
  avg_duration_ms: number | null // average total duration across trades with timing data
}

export function aggregate(trades: TradeRecord[]): AggregateStats {
  const result: AggregateStats = {
    count: trades.length,
    net_pnl: 0,
    gross_pnl: 0,
    fees: 0,
    wins: 0,
    losses: 0,
    scratches: 0,
    win_rate: null,
    best: null,
    worst: null,
    avg_planned_rr: null,
    avg_realized_rr: null,
    avg_risk: null,
    avg_win: null,
    avg_loss: null,
    avg_duration_ms: null,
  }
  if (trades.length === 0) return result

  let plannedSum = 0
  let plannedCount = 0
  let realizedSum = 0
  let realizedCount = 0
  let riskSum = 0
  let riskCount = 0
  let winSum = 0
  let lossSum = 0
  let durationSum = 0
  let durationCount = 0

  for (const t of trades) {
    const net = computeNetPnl(t) ?? 0
    result.net_pnl += net
    const gross = computeGrossPnl(t) ?? 0
    result.gross_pnl += gross
    result.fees += computeFees(t)

    const outcome = classifyTrade(t)
    if (outcome === 'win') {
      result.wins++
      winSum += net
    } else if (outcome === 'loss') {
      result.losses++
      lossSum += net
    } else {
      result.scratches++
    }

    if (result.best === null || net > result.best) result.best = net
    if (result.worst === null || net < result.worst) result.worst = net

    const planned = computePlannedRr(t)
    if (planned !== null) {
      plannedSum += planned
      plannedCount++
    }
    const realized = computeRealizedRr(t)
    if (realized !== null) {
      realizedSum += realized
      realizedCount++
    }

    if (t.stop_loss > 0) {
      riskSum += t.stop_loss
      riskCount++
    }

    const dur = computeDuration(t).total_ms
    if (dur !== null) {
      durationSum += dur
      durationCount++
    }
  }

  const decided = result.wins + result.losses
  result.win_rate = decided === 0 ? null : result.wins / decided
  result.avg_planned_rr = plannedCount > 0 ? plannedSum / plannedCount : null
  result.avg_realized_rr = realizedCount > 0 ? realizedSum / realizedCount : null
  result.avg_risk = riskCount > 0 ? riskSum / riskCount : null
  result.avg_win = result.wins > 0 ? winSum / result.wins : null
  result.avg_loss = result.losses > 0 ? lossSum / result.losses : null
  result.avg_duration_ms = durationCount > 0 ? durationSum / durationCount : null

  return result
}

// -----------------------------------------------------------------------------
// Equity candle computation
// -----------------------------------------------------------------------------
//
// Each bucket maps to one OHLC candle. Wicks are based on REALIZED equity only
// — the running equity as trades close, not per-trade MFE/MAE. A day that goes
// +200, then loses a -40 trade, shows a wick high at +200 and a close at +160.
//
//   open   — equity at start of bucket, INCLUDING this bucket's net cash flow
//   close  — open + the bucket's trading PNL
//   high   — peak running equity reached within the bucket
//   low    — trough running equity reached within the bucket
//   fees   — total broker fees paid during the bucket
//
// Each bucket's net cash flow (deposits/withdrawals/fees) is folded into its
// OPENING baseline, so the candle opens at the funded equity level and the
// trades sit on top of it. This keeps the wicks honest (a funded account can't
// draw an impossible sub-zero wick) and means a funded account's first candle
// opens at its capital rather than at zero. The trade-off: a cash flow is
// attributed to the start of whichever bucket (timeframe) contains it — so at
// coarser zoom the deposit snaps to the bucket's open. The starting equity for
// bucket i+1 is the close of bucket i, so candles chain into a continuous curve.

export interface CandlePoint {
  key: string
  label: string
  open: number
  close: number
  high: number
  low: number
  fees: number
  count: number
  adjustment: number // signed cash flow on this bucket (deposit+ / withdraw-)
  isOverride: boolean
}

// Order by first-execution time, with `id` as a deterministic tie-break:
// execution times are second-resolution, so two trades on the same second
// would otherwise sort in whatever order Dexie returned them — and since
// high/low accumulate path-dependently, that would flicker the wicks.
function byExecutionThenId(a: TradeRecord, b2: TradeRecord): number {
  const d = (firstExecutionMs(a) ?? 0) - (firstExecutionMs(b2) ?? 0)
  if (d !== 0) return d
  return a.id < b2.id ? -1 : a.id > b2.id ? 1 : 0
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

// The ordered list of YYYY-MM-DD day keys a bucket spans, or `null` for a
// single-day bucket (the daily timeframe) or a synthetic bucket whose
// range isn't a real date (test fixtures). Coarser timeframes — weekly,
// monthly, … — return the full run of days so each day's cash flow folds
// into THAT day's open instead of snapping to the whole bucket's open.
// That keeps the intra-bucket equity path identical no matter how days are
// grouped, so a weekly high is exactly the max of its daily highs and the
// extremes reconcile across every zoom level.
function bucketDayKeys(b: Bucket): string[] | null {
  if (
    !DATE_KEY_RE.test(b.rangeStart) ||
    !DATE_KEY_RE.test(b.rangeEnd) ||
    b.rangeStart === b.rangeEnd
  ) {
    return null
  }
  const out: string[] = []
  let d = dateKeyToDate(b.rangeStart)
  const end = dateKeyToDate(b.rangeEnd)
  while (d <= end) {
    out.push(format(d, 'yyyy-MM-dd'))
    d = addDays(d, 1)
  }
  return out
}

function candleFromBucket(
  b: Bucket,
  startEquity: number,
  adjustmentsByDate: Map<string, number>,
  overridesByDate?: Map<string, number>,
): CandlePoint {
  // Each day's cash flow is folded into THAT day's opening baseline, then the
  // day's trades walk on top of it. open already includes the deposit/withdrawal
  // for the day it lands on, so trades never sit on a pre-funding baseline and
  // the wicks stay realistic — while the high/low still track the true path
  // across the whole bucket.
  let running = startEquity
  let initialized = false
  let open = startEquity
  let high = startEquity
  let low = startEquity
  let fees = 0
  let bucketAdjustment = 0

  const record = (v: number) => {
    if (!initialized) {
      open = v
      high = v
      low = v
      initialized = true
    } else {
      if (v > high) high = v
      if (v < low) low = v
    }
  }

  // Override dates inside this bucket. A day-level override replaces that day's
  // trades (and their fees) with a single net-PNL step.
  const overrideDates = new Set<string>()
  if (overridesByDate) {
    for (const date of overridesByDate.keys()) {
      if (date >= b.rangeStart && date <= b.rangeEnd) overrideDates.add(date)
    }
  }

  const dayKeys = bucketDayKeys(b)
  if (dayKeys) {
    // Multi-day bucket. Fold the bucket's ENTIRE cash flow into the open (as in
    // the single-day path) so the candle body stays trading-only — a deposit /
    // withdrawal shifts the baseline, never the body. Trades and overrides then
    // walk per-day on top for a realistic wick path. Trade-off: a deposit that
    // lands mid-bucket lifts the baseline for the whole bucket, so a dip that
    // happened before it won't draw a wick below the funded level.
    const byDate = new Map<string, TradeRecord[]>()
    for (const t of b.trades) {
      const a = byDate.get(t.date)
      if (a) a.push(t)
      else byDate.set(t.date, [t])
    }
    for (const dk of dayKeys) bucketAdjustment += adjustmentsByDate.get(dk) ?? 0
    running += bucketAdjustment
    record(running)
    for (const dk of dayKeys) {
      if (overrideDates.has(dk)) {
        // Override is the day's net (already net of its own fees) — replace the
        // day's trades wholesale and skip their fees.
        running += overridesByDate!.get(dk)!
        record(running)
        continue
      }
      const dayTrades = byDate.get(dk)
      if (dayTrades) {
        for (const t of [...dayTrades].sort(byExecutionThenId)) {
          running += computeNetPnl(t) ?? 0
          record(running)
          fees += computeFees(t)
        }
      }
    }
  } else {
    // Single-day (or synthetic) bucket: the whole bucket's cash flow folds into
    // its one open, then every trade walks on top.
    bucketAdjustment = adjustmentsByDate.get(b.key) ?? 0
    running += bucketAdjustment
    record(running)
    if (overrideDates.has(b.rangeStart)) {
      running += overridesByDate!.get(b.rangeStart)!
      record(running)
    } else {
      for (const t of [...b.trades].sort(byExecutionThenId)) {
        running += computeNetPnl(t) ?? 0
        record(running)
        fees += computeFees(t)
      }
    }
  }

  return {
    key: b.key,
    label: b.label,
    open,
    close: running,
    high,
    low,
    fees,
    count: b.trades.length,
    adjustment: bucketAdjustment,
    isOverride: overrideDates.size > 0,
  }
}

export function computeCandles(
  buckets: Bucket[],
  adjustmentsByDate: Map<string, number> = new Map(),
  startEquity = 0,
  overridesByDate?: Map<string, number>,
): CandlePoint[] {
  const out: CandlePoint[] = []
  let running = startEquity
  for (const b of buckets) {
    const c = candleFromBucket(b, running, adjustmentsByDate, overridesByDate)
    out.push(c)
    // `close` already includes this bucket's cash flow (folded per-day into the
    // day it lands on), so the next bucket opens right at the close.
    running = c.close
  }
  return out
}

/** Groups signed adjustments by their date string (bucket key for day buckets). */
export function adjustmentsByDate(adjustments: EquityAdjustment[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const a of adjustments) {
    m.set(a.date, (m.get(a.date) ?? 0) + signedAdjustment(a))
  }
  return m
}
