import type { EquityAdjustment, TradeRecord } from '@/db/types'
import { computeNetPnl } from '@/lib/trade-math'
import { signedAdjustment } from '@/lib/trade-stats'

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

/**
 * Account equity immediately before `dateKey`: the account's opening capital
 * plus every signed cash flow and cumulative net PNL from all activity strictly
 * earlier than that date. The single source for every "equity entering this
 * window" baseline — the calendar's per-day scratch band, Overview's composite
 * and chart baselines.
 *
 * `startingBalance` is `Account.starting_balance` and is dateless on purpose:
 * it's where the account begins, so it belongs to every window regardless of
 * cutoff. Required rather than defaulted — a call site that silently fell back
 * to 0 would draw a funded account's curve from zero.
 *
 * Reads off maps the caller already holds rather than querying by date. That's
 * deliberate: a Dexie query keyed on a cutoff date hands back the PREVIOUS
 * date's value for one render after the cutoff moves (dexie-react-hooks keeps
 * its result across a deps change), which shows up as a baseline shifting under
 * the UI for a frame.
 *
 * `netByDate` is the account's FULL day → net map (`netPnlByDate` over every
 * trade, with every override folded in). Passing the whole thing is what lets
 * the caller build it once per data change rather than once per window; the
 * date cut happens here.
 */
export function equityBefore(
  dateKey: string,
  netByDate: Map<string, number>,
  adjustments: EquityAdjustment[],
  startingBalance: number,
): number {
  let eq = startingBalance
  for (const a of adjustments) {
    if (a.date < dateKey) eq += signedAdjustment(a)
  }
  return eq + sumNetPnl(netByDate, d => d < dateKey)
}
