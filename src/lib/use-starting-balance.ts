import { getAccount } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { useAccountQuery } from '@/lib/use-account-query'

/**
 * The active account's opening capital, or `undefined` while the row loads.
 *
 * Every windowed equity calculation starts from this rather than from 0 — see
 * `equityBefore` in `day-pnl`. Callers must fold it into their `loaded` gate:
 * arriving a render late redraws a funded account's curve from zero to funded,
 * and shifts the calendar's scratch band and every drawdown percentage with it.
 *
 * Resolves to a NUMBER rather than the account row on purpose: `getAccount`
 * returns `undefined` for a missing id, which through `useAccountQuery` would be
 * indistinguishable from "still loading" and would hang every gate that waits on
 * it. Collapsing a missing row to 0 here leaves `undefined` meaning only the one
 * thing callers test for.
 */
export function useStartingBalance(): number | undefined {
  const accountId = useActiveAccountId()
  return useAccountQuery(
    accountId,
    async () => (await getAccount(accountId))?.starting_balance ?? 0,
  )
}
