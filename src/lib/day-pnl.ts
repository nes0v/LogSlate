import type { EquityAdjustment, TradeRecord } from '@/db/types'
import { computeNetPnl } from '@/lib/trade-math'
import { signedAdjustment } from '@/lib/trade-stats'
import { resolveResets } from '@/lib/adjustment-resets'

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

// Sorts after any real YYYY-MM-DD, so a cut at this key means "everything".
const MAX_DATE_KEY = '9999-12-31'

/**
 * Equity on one side of a date cut: opening capital, plus every signed cash
 * flow and net PNL falling inside the cut.
 *
 * Resets are resolved HERE rather than trusted from the caller. A reset row
 * stores a target balance, not a movement, so summing an unresolved one
 * silently drops it — and this is the funnel every windowed equity number in
 * the app flows through, which makes it the right place to make that
 * impossible. Resolution is idempotent, so callers that already resolved for
 * their own per-day maps lose nothing by passing the resolved list.
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
function equityAcrossCut(
  dateKey: string,
  netByDate: Map<string, number>,
  adjustments: EquityAdjustment[],
  startingBalance: number,
  inclusive: boolean,
): number {
  const within = inclusive
    ? (d: string) => d <= dateKey
    : (d: string) => d < dateKey
  let eq = startingBalance
  for (const a of resolveResets(adjustments, netByDate, startingBalance)) {
    if (within(a.date)) eq += signedAdjustment(a)
  }
  return eq + sumNetPnl(netByDate, within)
}

/**
 * Account equity immediately before `dateKey` — that day's own activity
 * EXCLUDED. The single source for every "equity entering this window"
 * baseline: the calendar's per-day scratch band, Overview's composite and
 * chart baselines.
 *
 * `startingBalance` is `Account.starting_balance` and is dateless on purpose:
 * it's where the account begins, so it belongs to every window regardless of
 * cutoff.
 *
 * It has no default, which forces every caller to go and fetch it — but that is
 * all the signature buys. Callers still bridge the `number | undefined` their
 * query hands them with `?? 0`, so what actually keeps a funded account from
 * being drawn from zero is the caller's render gate: every route calling this
 * holds `startingBalance !== undefined` in its `loaded` flag. Drop it from the
 * gate and the parameter being required will not save you.
 */
export function equityBefore(
  dateKey: string,
  netByDate: Map<string, number>,
  adjustments: EquityAdjustment[],
  startingBalance: number,
): number {
  return equityAcrossCut(dateKey, netByDate, adjustments, startingBalance, false)
}

/**
 * Equity at the END of `dateKey` — that day's activity INCLUDED. The inclusive
 * sibling of `equityBefore`; the reset dialog prices against it so a
 * back-dated reset is measured by what equity actually was that evening.
 */
export function accountEquityThrough(
  dateKey: string,
  netByDate: Map<string, number>,
  adjustments: EquityAdjustment[],
  startingBalance: number,
): number {
  return equityAcrossCut(dateKey, netByDate, adjustments, startingBalance, true)
}

/**
 * Equity across ALL of an account's history — the number the header shows.
 * The uncut sibling of the two above.
 */
export function accountEquity(
  netByDate: Map<string, number>,
  adjustments: EquityAdjustment[],
  startingBalance: number,
): number {
  return accountEquityThrough(MAX_DATE_KEY, netByDate, adjustments, startingBalance)
}
