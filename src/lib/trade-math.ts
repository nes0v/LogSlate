import type { Execution, Side, TradeRecord } from '@/db/types'
import { FEE_PER_SIDE, handleValue } from '@/lib/symbols'

// ---------- small helpers ----------

function sumContracts(execs: Execution[]): number {
  return execs.reduce((n, e) => n + e.contracts, 0)
}

function weightedAvgPrice(execs: Execution[]): number | null {
  const qty = sumContracts(execs)
  if (qty === 0) return null
  const notional = execs.reduce((n, e) => n + e.price * e.contracts, 0)
  return notional / qty
}

function firstTime(execs: Execution[]): number | null {
  if (execs.length === 0) return null
  let min = Infinity
  for (const e of execs) {
    const t = Date.parse(e.time)
    if (!Number.isNaN(t) && t < min) min = t
  }
  return min === Infinity ? null : min
}

// ---------- public API ----------

export function inferSide(t: Pick<TradeRecord, 'buys' | 'sells'>): Side | null {
  const firstBuy = firstTime(t.buys)
  const firstSell = firstTime(t.sells)
  if (firstBuy === null && firstSell === null) return null
  if (firstBuy === null) return 'short'
  if (firstSell === null) return 'long'
  return firstBuy <= firstSell ? 'long' : 'short'
}

export function totalContracts(t: Pick<TradeRecord, 'buys' | 'sells'>): number {
  // For a closed trade, buys.contracts === sells.contracts. Use the max to
  // reflect "position size at peak" when data is incomplete.
  return Math.max(sumContracts(t.buys), sumContracts(t.sells))
}

export interface TradeDuration {
  total_ms: number | null
  before_first_exit_ms: number | null
}

export function computeDuration(t: Pick<TradeRecord, 'buys' | 'sells'>): TradeDuration {
  const side = inferSide(t)
  const allTimes = [...t.buys, ...t.sells].map(e => Date.parse(e.time)).filter(n => !Number.isNaN(n))
  if (allTimes.length < 2) return { total_ms: null, before_first_exit_ms: null }
  const start = Math.min(...allTimes)
  const end = Math.max(...allTimes)

  let before: number | null = null
  if (side === 'long') {
    const firstSell = firstTime(t.sells)
    if (firstSell !== null) before = firstSell - start
  } else if (side === 'short') {
    const firstBuy = firstTime(t.buys)
    if (firstBuy !== null) before = firstBuy - start
  }
  return { total_ms: end - start, before_first_exit_ms: before }
}

export function computeFees(t: Pick<TradeRecord, 'buys' | 'sells'>): number {
  const sides = sumContracts(t.buys) + sumContracts(t.sells)
  return sides * FEE_PER_SIDE
}

export function computeGrossPnl(
  t: Pick<TradeRecord, 'buys' | 'sells' | 'symbol' | 'contract_type'>,
): number | null {
  const avgBuy = weightedAvgPrice(t.buys)
  const avgSell = weightedAvgPrice(t.sells)
  if (avgBuy === null || avgSell === null) return null
  const contracts = Math.min(sumContracts(t.buys), sumContracts(t.sells))
  if (contracts === 0) return null
  // Symmetric: profit = avgSell − avgBuy regardless of side (long or short).
  const handles = avgSell - avgBuy
  return handles * contracts * handleValue(t.symbol, t.contract_type)
}

export function computeNetPnl(
  t: Pick<TradeRecord, 'buys' | 'sells' | 'symbol' | 'contract_type'>,
): number | null {
  const gross = computeGrossPnl(t)
  if (gross === null) return null
  return gross - computeFees(t)
}

// Net PnL used for display: manual override wins if set, else computed.
export function effectivePnl(
  t: Pick<TradeRecord, 'buys' | 'sells' | 'symbol' | 'contract_type' | 'pnl_override'>,
): number | null {
  if (t.pnl_override !== null && t.pnl_override !== undefined) return t.pnl_override
  return computeNetPnl(t)
}

// Average handles per contract. Positive = profitable, negative = losing.
// Symmetric across long/short: avgSell − avgBuy is profit direction in both cases.
export function computeAhpc(t: Pick<TradeRecord, 'buys' | 'sells'>): number | null {
  const avgBuy = weightedAvgPrice(t.buys)
  const avgSell = weightedAvgPrice(t.sells)
  if (avgBuy === null || avgSell === null) return null
  return avgSell - avgBuy
}

export function computeRealizedRr(
  t: Pick<TradeRecord, 'buys' | 'sells' | 'symbol' | 'contract_type' | 'pnl_override' | 'stop_loss'>,
): number | null {
  if (!t.stop_loss || t.stop_loss === 0) return null
  const pnl = effectivePnl(t)
  if (pnl === null) return null
  return pnl / t.stop_loss
}
