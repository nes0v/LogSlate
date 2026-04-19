import type { TradeRecord } from '@/db/types'
import type { Bucket } from '@/lib/buckets'
import { computeFees, computeGrossPnl, computeRealizedRr, effectivePnl } from '@/lib/trade-math'

export interface AggregateStats {
  count: number
  net_pnl: number
  gross_pnl: number
  fees: number
  wins: number
  losses: number
  breakevens: number
  win_rate: number | null // 0–1, excluding breakevens from denominator
  best: number | null
  worst: number | null
  avg_planned_rr: number | null
  avg_realized_rr: number | null
}

export function aggregate(trades: TradeRecord[]): AggregateStats {
  const result: AggregateStats = {
    count: trades.length,
    net_pnl: 0,
    gross_pnl: 0,
    fees: 0,
    wins: 0,
    losses: 0,
    breakevens: 0,
    win_rate: null,
    best: null,
    worst: null,
    avg_planned_rr: null,
    avg_realized_rr: null,
  }
  if (trades.length === 0) return result

  let plannedSum = 0
  let realizedSum = 0
  let realizedCount = 0

  for (const t of trades) {
    const net = effectivePnl(t) ?? 0
    result.net_pnl += net
    const gross = computeGrossPnl(t) ?? 0
    result.gross_pnl += gross
    result.fees += computeFees(t)

    if (net > 0) result.wins++
    else if (net < 0) result.losses++
    else result.breakevens++

    if (result.best === null || net > result.best) result.best = net
    if (result.worst === null || net < result.worst) result.worst = net

    plannedSum += t.planned_rr
    const realized = computeRealizedRr(t)
    if (realized !== null) {
      realizedSum += realized
      realizedCount++
    }
  }

  const decided = result.wins + result.losses
  result.win_rate = decided === 0 ? null : result.wins / decided
  result.avg_planned_rr = trades.length > 0 ? plannedSum / trades.length : null
  result.avg_realized_rr = realizedCount > 0 ? realizedSum / realizedCount : null

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
//   open   — running equity at start of bucket
//   close  — running equity at end of bucket (after all trades close)
//   high   — peak realized running equity between trades
//   low    — trough realized running equity between trades
//   fees   — total broker fees paid during the bucket
//
// The starting equity for bucket i+1 is the close of bucket i, so candles
// chain into a continuous equity curve. The first bucket opens at 0, so the
// chart is a relative-equity view for the period.

export interface CandlePoint {
  key: string
  label: string
  open: number
  close: number
  high: number
  low: number
  fees: number
  count: number
}

function firstExecTime(t: TradeRecord): number {
  let min = Infinity
  for (const e of t.executions) {
    const ms = Date.parse(e.time)
    if (!Number.isNaN(ms) && ms < min) min = ms
  }
  return min === Infinity ? 0 : min
}

function candleFromBucket(b: Bucket, startEquity: number): CandlePoint {
  let running = startEquity
  let high = running
  let low = running
  let fees = 0

  const sorted = [...b.trades].sort((a, b2) => firstExecTime(a) - firstExecTime(b2))
  for (const t of sorted) {
    running += effectivePnl(t) ?? 0
    if (running > high) high = running
    if (running < low) low = running
    fees += computeFees(t)
  }

  return {
    key: b.key,
    label: b.label,
    open: startEquity,
    close: running,
    high,
    low,
    fees,
    count: b.trades.length,
  }
}

export function computeCandles(buckets: Bucket[], startEquity = 0): CandlePoint[] {
  const out: CandlePoint[] = []
  let running = startEquity
  for (const b of buckets) {
    const c = candleFromBucket(b, running)
    out.push(c)
    running = c.close
  }
  return out
}
