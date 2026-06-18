import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { listAdjustments, listAllTrades, listDayPnlOverrides } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { signedAdjustment } from '@/lib/trade-stats'
import { netPnlByDate, sumNetPnl } from '@/lib/day-pnl'

/**
 * Account equity immediately before `dateKey` (YYYY-MM-DD): signed cash flows
 * plus cumulative net PNL from every trade in the active account whose
 * `date` is strictly before `dateKey`. Used as the denominator for ROI
 * so that mid-period deposits/withdrawals don't skew the percentage.
 *
 * Returns 0 until the underlying live queries resolve (or when `dateKey` is
 * falsy). A non-positive return value means ROI has no meaningful baseline.
 */
/**
 * Current account equity = all signed adjustments plus cumulative net PNL
 * across every trade in the active account. Live-reactive to every
 * trade/adjustment change so the header indicator stays in sync.
 *
 * Returns `undefined` until both underlying queries have resolved — the
 * caller is expected to render nothing (or a placeholder) instead of
 * showing a flash of $0 before real data arrives.
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

export function useStartingEquity(dateKey: string | null | undefined): number | undefined {
  const accountId = useActiveAccountId()
  const priorAdjustments = useLiveQuery(
    () => {
      if (!dateKey) return []
      return db.adjustments
        .where('[account_id+date]')
        .between([accountId, ''], [accountId, dateKey], true, false)
        .toArray()
    },
    [accountId, dateKey],
  )
  const priorTrades = useLiveQuery(
    () => {
      if (!dateKey) return []
      return db.trades
        .where('[account_id+date]')
        .between([accountId, ''], [accountId, dateKey], true, false)
        .toArray()
    },
    [accountId, dateKey],
  )
  const overrides = useLiveQuery(() => listDayPnlOverrides(accountId), [accountId])
  return useMemo(() => {
    if (!priorAdjustments || !priorTrades || !overrides) return undefined
    let eq = 0
    for (const a of priorAdjustments) eq += signedAdjustment(a)
    // Override-only days before `dateKey` aren't in `priorTrades`; restricting
    // the day-net map by date picks them up while excluding on/after `dateKey`.
    eq += sumNetPnl(netPnlByDate(priorTrades, overrides), d => d < dateKey!)
    return eq
  }, [priorAdjustments, priorTrades, overrides, dateKey])
}
