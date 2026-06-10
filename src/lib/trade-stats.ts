import type { EquityAdjustment, TradeRecord } from '@/db/types'
import type { Bucket } from '@/lib/buckets'
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
  avg_win: number | null // average net PnL of winning trades (positive)
  avg_loss: number | null // average net PnL of losing trades (negative)
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
//   close  — open + the bucket's trading P&L
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
}

function candleFromBucket(
  b: Bucket,
  startEquity: number,
  bucketAdjustment: number,
): CandlePoint {
  // Fold the bucket's cash flow into the opening baseline, then walk the trades
  // on top of it. open already includes the deposit/withdrawal, so trades never
  // sit on a pre-funding baseline and the wicks stay realistic.
  let running = startEquity + bucketAdjustment
  const open = running
  let high = running
  let low = running
  let fees = 0

  // Order by first-execution time, with `id` as a deterministic tie-break:
  // execution times are second-resolution, so two trades on the same second
  // would otherwise sort in whatever order Dexie returned them — and since
  // high/low accumulate path-dependently, that would flicker the wicks.
  const sorted = [...b.trades].sort((a, b2) => {
    const d = (firstExecutionMs(a) ?? 0) - (firstExecutionMs(b2) ?? 0)
    if (d !== 0) return d
    return a.id < b2.id ? -1 : a.id > b2.id ? 1 : 0
  })
  for (const t of sorted) {
    running += computeNetPnl(t) ?? 0
    if (running > high) high = running
    if (running < low) low = running
    fees += computeFees(t)
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
  }
}

export function computeCandles(
  buckets: Bucket[],
  adjustmentsByBucket: Map<string, number> = new Map(),
  startEquity = 0,
): CandlePoint[] {
  const out: CandlePoint[] = []
  let running = startEquity
  for (const b of buckets) {
    const adj = adjustmentsByBucket.get(b.key) ?? 0
    const c = candleFromBucket(b, running, adj)
    out.push(c)
    // `close` already includes this bucket's cash flow (folded into its open),
    // so the next bucket opens right at the close.
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
