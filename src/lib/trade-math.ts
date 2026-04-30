import type { Execution, Side, SymbolKey, TradeRecord } from '@/db/types'
import { feePerSide, handleValue } from '@/lib/symbols'

// ---------- small helpers ----------

function buysOf(execs: Execution[]): Execution[] {
  return execs.filter(e => e.kind === 'buy')
}
function sellsOf(execs: Execution[]): Execution[] {
  return execs.filter(e => e.kind === 'sell')
}

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

// Earliest valid `time` across all executions, in epoch ms. Used by list
// views to sort trades chronologically inside a single day.
export function firstExecutionMs(
  t: Pick<TradeRecord, 'executions'>,
): number | null {
  return firstTime(t.executions)
}

// ---------- public API ----------

export function inferSide(t: Pick<TradeRecord, 'executions'>): Side | null {
  const firstBuy = firstTime(buysOf(t.executions))
  const firstSell = firstTime(sellsOf(t.executions))
  if (firstBuy === null && firstSell === null) return null
  if (firstBuy === null) return 'short'
  if (firstSell === null) return 'long'
  return firstBuy <= firstSell ? 'long' : 'short'
}

export function totalContracts(t: Pick<TradeRecord, 'executions'>): number {
  // For a closed trade, buys.contracts === sells.contracts. Use the max to
  // reflect "position size at peak" when data is incomplete.
  return Math.max(sumContracts(buysOf(t.executions)), sumContracts(sellsOf(t.executions)))
}

export interface TradeDuration {
  total_ms: number | null
  before_first_exit_ms: number | null
}

export function computeDuration(t: Pick<TradeRecord, 'executions'>): TradeDuration {
  const side = inferSide(t)
  const allTimes = t.executions.map(e => Date.parse(e.time)).filter(n => !Number.isNaN(n))
  if (allTimes.length < 2) return { total_ms: null, before_first_exit_ms: null }
  const start = Math.min(...allTimes)
  const end = Math.max(...allTimes)

  let before: number | null = null
  if (side === 'long') {
    const firstSell = firstTime(sellsOf(t.executions))
    if (firstSell !== null) before = firstSell - start
  } else if (side === 'short') {
    const firstBuy = firstTime(buysOf(t.executions))
    if (firstBuy !== null) before = firstBuy - start
  }
  return { total_ms: end - start, before_first_exit_ms: before }
}

export function computeFees(t: Pick<TradeRecord, 'executions' | 'contract_type'>): number {
  const sides = sumContracts(t.executions)
  return sides * feePerSide(t.contract_type)
}

export function computeGrossPnl(
  t: Pick<TradeRecord, 'executions' | 'symbol' | 'contract_type'>,
): number | null {
  const buys = buysOf(t.executions)
  const sells = sellsOf(t.executions)
  const avgBuy = weightedAvgPrice(buys)
  const avgSell = weightedAvgPrice(sells)
  if (avgBuy === null || avgSell === null) return null
  const contracts = Math.min(sumContracts(buys), sumContracts(sells))
  if (contracts === 0) return null
  // Symmetric: profit = avgSell − avgBuy regardless of side (long or short).
  const handles = avgSell - avgBuy
  return handles * contracts * handleValue(t.symbol, t.contract_type)
}

export function computeNetPnl(
  t: Pick<TradeRecord, 'executions' | 'symbol' | 'contract_type'>,
): number | null {
  const gross = computeGrossPnl(t)
  if (gross === null) return null
  return gross - computeFees(t)
}

// Average handles per contract. Positive = profitable, negative = losing.
// Symmetric across long/short: avgSell − avgBuy is profit direction in both cases.
export function computeAhpc(t: Pick<TradeRecord, 'executions'>): number | null {
  const avgBuy = weightedAvgPrice(buysOf(t.executions))
  const avgSell = weightedAvgPrice(sellsOf(t.executions))
  if (avgBuy === null || avgSell === null) return null
  return avgSell - avgBuy
}

export function computeRealizedRr(
  t: Pick<TradeRecord, 'executions' | 'symbol' | 'contract_type' | 'stop_loss'>,
): number | null {
  if (!t.stop_loss || t.stop_loss === 0) return null
  const pnl = computeNetPnl(t)
  if (pnl === null) return null
  return pnl / t.stop_loss
}

// Planned R:R is derived from the user's stop loss and profit target —
// no longer a separately stored field. Returns null when stop loss is
// missing/zero or profit target is missing.
export function computePlannedRr(
  t: Pick<TradeRecord, 'stop_loss' | 'profit_target'>,
): number | null {
  if (!t.stop_loss || t.stop_loss === 0) return null
  if (t.profit_target == null) return null
  return t.profit_target / t.stop_loss
}

// True when `next` reverses `prev`: prev's closing exec price equals next's
// opening exec price, sides are opposite, and the instrument matches. This
// captures the real-world "flip" where one fill closes the long and opens
// the short (or vice versa) at the same price.
export function isReversal(
  prev: Pick<TradeRecord, 'executions' | 'symbol' | 'contract_type'>,
  next: Pick<TradeRecord, 'executions' | 'symbol' | 'contract_type'>,
): boolean {
  if (prev.symbol !== next.symbol || prev.contract_type !== next.contract_type) return false
  const prevSide = inferSide(prev)
  const nextSide = inferSide(next)
  if (!prevSide || !nextSide || prevSide === nextSide) return false

  const prevExecs = [...prev.executions].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  const nextExecs = [...next.executions].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  const prevLast = prevExecs[prevExecs.length - 1]
  const nextFirst = nextExecs[0]
  if (!prevLast || !nextFirst) return false
  return prevLast.price === nextFirst.price && prevLast.time === nextFirst.time
}

// Trades that didn't move the market by at least this many handles in
// either direction count as "scratch" — neither a winner nor a loser.
// NQ moves in larger ticks than ES, so the bands differ per symbol.
export const BREAKEVEN_HANDLES: Record<SymbolKey, number> = {
  NQ: 5,
  ES: 2,
}

export type TradeOutcome = 'win' | 'loss' | 'breakeven'

// Tailwind class for tinting text by outcome. Centralised so the trade
// table, LiveStatsSection, and any future row-shaped UI agree on the mapping.
export function outcomeTextClass(
  outcome: TradeOutcome,
  hasPnl: boolean,
): string {
  if (!hasPnl) return 'text-(--color-text-dim)'
  if (outcome === 'win') return 'text-(--color-win)'
  if (outcome === 'loss') return 'text-(--color-loss)'
  return 'text-(--color-text)'
}

// Win/loss/breakeven classifier + the underlying ahpc and net PnL in a
// single pass. Many list views (TradeTable, Reports, advanced-stats) need
// all three numbers per trade — returning them together avoids redundant
// `weightedAvgPrice` / fee passes.
//
// Outcome rule: a trade whose absolute AHPC sits below `BREAKEVEN_HANDLES`
// is a scratch even when net PnL is non-zero; above the threshold, PnL
// sign decides.
export interface TradeMetrics {
  ahpc: number | null
  pnl: number | null
  outcome: TradeOutcome
}
export function tradeMetrics(
  t: Pick<TradeRecord, 'executions' | 'symbol' | 'contract_type'>,
): TradeMetrics {
  const ahpc = computeAhpc(t)
  const pnl = computeNetPnl(t)
  let outcome: TradeOutcome
  if (ahpc !== null && Math.abs(ahpc) < BREAKEVEN_HANDLES[t.symbol]) outcome = 'breakeven'
  else if (pnl === null || pnl === 0) outcome = 'breakeven'
  else outcome = pnl > 0 ? 'win' : 'loss'
  return { ahpc, pnl, outcome }
}

// Outcome-only helper kept for callers that don't need ahpc/pnl.
export function classifyTrade(
  t: Pick<TradeRecord, 'executions' | 'symbol' | 'contract_type'>,
): TradeOutcome {
  return tradeMetrics(t).outcome
}
