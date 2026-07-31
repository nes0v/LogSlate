import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listAdjustments, listAllTrades, listDayPnlOverrides } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { signedAdjustment } from '@/lib/trade-stats'
import { netPnlByDate, sumNetPnl } from '@/lib/day-pnl'

/**
 * Current account equity = all signed adjustments plus cumulative net PNL
 * across every trade in the active account. Live-reactive to every
 * trade/adjustment change so the header indicator stays in sync.
 *
 * Returns `undefined` until every underlying query has resolved — the caller
 * is expected to render nothing (or a placeholder) instead of showing a flash
 * of $0 before real data arrives.
 *
 * For equity as it stood entering a window, see `equityBefore` in `day-pnl`:
 * it reads off maps the caller already holds, so it can't lag them by a render
 * the way a date-keyed query does.
 */
export function useCurrentEquity(): number | undefined {
  const accountId = useActiveAccountId()
  const adjustments = useLiveQuery(() => listAdjustments(accountId), [accountId])
  const trades = useLiveQuery(() => listAllTrades(accountId), [accountId])
  const overrides = useLiveQuery(() => listDayPnlOverrides(accountId), [accountId])
  return useMemo(() => {
    if (!adjustments || !trades || !overrides) return undefined
    let eq = 0
    for (const a of adjustments) eq += signedAdjustment(a)
    eq += sumNetPnl(netPnlByDate(trades, overrides))
    return eq
  }, [adjustments, trades, overrides])
}
