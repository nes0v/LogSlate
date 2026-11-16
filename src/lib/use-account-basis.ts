import { useMemo } from 'react'
import { getAccount } from '@/db/queries'
import type { LossLimit } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { lossLimitOf } from '@/lib/loss-limit'
import { useAccountQuery } from '@/lib/use-account-query'

/** The active account's settings that every equity walk starts from. */
export interface AccountBasis {
  /** Opening capital — see `equityBefore` in `day-pnl`. */
  startingBalance: number
  /** Loss-limit rules — see `src/lib/loss-limit.ts`. */
  lossLimit: LossLimit
}

/**
 * The active account's opening capital and loss-limit rules from ONE
 * subscription to its row, or `undefined` while the row loads. Callers fold it
 * into their `loaded` gate: arriving a render late redraws a funded account's
 * curve from zero to funded, repaints near-threshold calendar days, shifts the
 * Reports day win rate, and flips the header's BREACHED state.
 *
 * A missing row resolves to 0 / no limit rather than `undefined`, which through
 * `useAccountQuery` would be indistinguishable from "still loading" and hang
 * every gate waiting on it.
 *
 * The result keeps its identity until one of its values actually changes. The
 * live query hands back a fresh object on every write to the row (`updated_at`
 * alone is enough), and the header re-walks every trade for `isBreached`
 * whenever the basis changes identity.
 */
export function useAccountBasis(): AccountBasis | undefined {
  const accountId = useActiveAccountId()
  const raw = useAccountQuery(accountId, async () => {
    const a = await getAccount(accountId)
    return { startingBalance: a?.starting_balance ?? 0, ...lossLimitOf(a) }
  })
  const loading = raw === undefined
  const startingBalance = raw?.startingBalance ?? 0
  const maxLoss = raw?.max_loss_usd ?? null
  const trailing = raw?.trailing ?? false
  const stop = raw?.trail_stop_usd ?? null
  return useMemo(
    () =>
      loading
        ? undefined
        : {
            startingBalance,
            lossLimit: { max_loss_usd: maxLoss, trailing, trail_stop_usd: stop },
          },
    [loading, startingBalance, maxLoss, trailing, stop],
  )
}
