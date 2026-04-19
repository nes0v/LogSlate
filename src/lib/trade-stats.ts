import type { TradeRecord } from '@/db/types'
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
