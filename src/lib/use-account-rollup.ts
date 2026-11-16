import { useMemo } from 'react'
import { listAdjustments, listAllTrades, listDayPnlOverrides } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { useAccountQuery } from '@/lib/use-account-query'
import { useAccountBasis } from '@/lib/use-account-basis'
import { accountEquity, netPnlByDate } from '@/lib/day-pnl'
import { isBreached, limitTimeline } from '@/lib/loss-limit'

export interface AccountRollup {
  /** The account's opening capital plus all signed adjustments plus cumulative
   *  net PNL across every trade in the active account. `undefined` until every
   *  underlying query has resolved — the caller renders nothing (or a
   *  placeholder) rather than flashing $0. */
  equity: number | undefined
  /** Most recent date carrying activity: the later of the newest trade date
   *  and the newest day-override date. `null` when the account has neither,
   *  `undefined` while loading. This is the anchor the Stats/Reports default
   *  date window is built from — see `last-activity-cache`. */
  lastActivityDate: string | null | undefined
  /** The balance has touched the loss limit at some point. Sticky: a blown
   *  account stays blown. Always false without a limit. */
  breached: boolean | undefined
}

/**
 * Account-wide totals derived from a single pass over the active account's
 * data. Live-reactive to every trade / adjustment / override change.
 *
 * Both values fall out of the same `netPnlByDate` map, so they share one set of
 * subscriptions. That matters because this is mounted in `Layout` and therefore
 * runs on every page: deriving the activity anchor here is free, where querying
 * for it separately meant a second scan of the days table app-wide. The one
 * extra subscription is the account row itself (`useAccountBasis`), a
 * primary-key `get` rather than a table scan.
 *
 * Queries go through `useAccountQuery`, so an account switch reports
 * `undefined` instead of briefly handing back the previous account's rows. That
 * keeps the header equity honest, and it is load-bearing for the anchor — a
 * stale value there gets written into a per-account localStorage cache under
 * the NEW account's key, where it would persist rather than self-correct.
 *
 * For equity as it stood entering a window, see `equityBefore` in `day-pnl`:
 * it reads off maps the caller already holds, so it can't lag them by a render
 * the way a date-keyed query does.
 */
export function useAccountRollup(): AccountRollup {
  const accountId = useActiveAccountId()
  const adjustments = useAccountQuery(accountId, () => listAdjustments(accountId))
  const trades = useAccountQuery(accountId, () => listAllTrades(accountId))
  const overrides = useAccountQuery(accountId, () => listDayPnlOverrides(accountId))
  const basis = useAccountBasis()
  return useMemo(() => {
    if (
      adjustments === undefined ||
      trades === undefined ||
      overrides === undefined ||
      basis === undefined
    ) {
      return { equity: undefined, lastActivityDate: undefined, breached: undefined }
    }
    // Keyed by every date that has a trade AND every override date, so its
    // newest key is exactly the activity anchor.
    const byDate = netPnlByDate(trades, overrides)
    const { startingBalance, lossLimit } = basis
    const equity = accountEquity(byDate, adjustments, startingBalance)
    let lastActivityDate: string | null = null
    for (const d of byDate.keys()) {
      if (lastActivityDate === null || d > lastActivityDate) lastActivityDate = d
    }
    const timeline = limitTimeline(lossLimit, startingBalance, byDate, adjustments)
    const breached = isBreached(timeline, startingBalance, trades, overrides, adjustments)
    return { equity, lastActivityDate, breached }
  }, [adjustments, trades, overrides, basis])
}
