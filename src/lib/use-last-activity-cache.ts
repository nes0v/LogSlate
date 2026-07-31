import { useEffect } from 'react'
import { clearLastActivityDate, writeLastActivityDate } from '@/lib/last-activity-cache'

/**
 * Sole owner of the per-account activity anchor (see `last-activity-cache`).
 * Mounted once in `Layout`, so it tracks the data no matter which page is open,
 * and fed from `useAccountRollup` so it costs no queries of its own.
 *
 * The anchor is what lets the Stats/Reports date pickers paint their default
 * window on the first frame, and it has to follow the data in BOTH directions:
 * a trade logged on a newer date pushes it forward, deleting the newest trade
 * or backdating it pulls it back. Owning it here rather than writing it from
 * `createTrade`/`updateTrade`/`deleteTrade` buys two things those call sites
 * can't:
 *
 *  - **Sync and import are covered.** The Drive merge writes trades into Dexie
 *    directly rather than through the mutation helpers, so per-mutation hooks
 *    would miss exactly the case where the anchor is most likely to jump —
 *    pulling in a day logged on another device. `liveQuery` observes the table
 *    itself, so it fires for those writes too.
 *  - **One place to reason about.** No "did every write path remember to update
 *    the cache" question, and no partial recomputation logic per call site.
 *
 * `lastActivityDate` is `undefined` while the rollup loads and during an
 * account switch, which is what stops one account's anchor being written under
 * another's key.
 */
export function useLastActivityCache(
  accountId: string,
  lastActivityDate: string | null | undefined,
): void {
  useEffect(() => {
    if (lastActivityDate === undefined) return
    // No activity at all — drop any anchor rather than leaving one that would
    // seed a date window for an account that now has nothing in it.
    if (lastActivityDate === null) clearLastActivityDate(accountId)
    else writeLastActivityDate(accountId, lastActivityDate)
  }, [accountId, lastActivityDate])
}
