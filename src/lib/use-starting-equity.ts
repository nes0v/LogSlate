import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import { signedAdjustment } from '@/lib/trade-stats'
import { effectivePnl } from '@/lib/trade-math'

/**
 * Account equity immediately before `dateKey` (YYYY-MM-DD): signed cash flows
 * plus cumulative net PnL from every trade in the active account whose
 * `trade_date` is strictly before `dateKey`. Used as the denominator for ROI
 * so that mid-period deposits/withdrawals don't skew the percentage.
 *
 * Returns 0 until the underlying live queries resolve (or when `dateKey` is
 * falsy). A non-positive return value means ROI has no meaningful baseline.
 */
export function useStartingEquity(dateKey: string | null | undefined): number {
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
    [],
  )
  const priorTrades = useLiveQuery(
    () => {
      if (!dateKey) return []
      return db.trades
        .where('[account_id+trade_date]')
        .between([accountId, ''], [accountId, dateKey], true, false)
        .toArray()
    },
    [accountId, dateKey],
    [],
  )
  return useMemo(() => {
    let eq = 0
    for (const a of priorAdjustments) eq += signedAdjustment(a)
    for (const t of priorTrades) eq += effectivePnl(t) ?? 0
    return eq
  }, [priorAdjustments, priorTrades])
}
