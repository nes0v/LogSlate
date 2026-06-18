import type { TradeRecord } from '@/db/types'
import { computeNetPnl } from '@/lib/trade-math'

// A day-level net-PNL override (`Day.pnl_override`) REPLACES the sum of that
// day's trade PNLs in every money/equity statistic. These helpers are the
// single place that rule lives, so every aggregation site folds overrides in
// the same way instead of each re-deriving it.

/**
 * Net realised PNL per day for a set of trades, with override days replaced.
 * `overrides` is a `date → value` map (see `listDayPnlOverrides`); any date
 * present in it takes the override value verbatim, discarding that day's
 * trade-derived sum. Override-only days (no trades) still appear in the
 * result, so callers that sum the map pick up their PNL.
 */
export function netPnlByDate(
  trades: TradeRecord[],
  overrides?: Map<string, number>,
): Map<string, number> {
  const byDate = new Map<string, number>()
  for (const t of trades) {
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + (computeNetPnl(t) ?? 0))
  }
  if (overrides) {
    for (const [date, value] of overrides) byDate.set(date, value)
  }
  return byDate
}

/** Sums a `date → pnl` map, optionally restricted to dates passing `pred`. */
export function sumNetPnl(
  byDate: Map<string, number>,
  pred?: (date: string) => boolean,
): number {
  let total = 0
  for (const [date, value] of byDate) {
    if (!pred || pred(date)) total += value
  }
  return total
}
