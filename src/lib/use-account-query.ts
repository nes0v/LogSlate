import { useLiveQuery } from 'dexie-react-hooks'

/**
 * `useLiveQuery` for account-scoped data that never hands back another
 * account's rows.
 *
 * dexie-react-hooks stores its result in a ref that re-subscribing does NOT
 * clear, so the render immediately after `accountId` changes still returns the
 * PREVIOUS account's rows — and a `loaded` gate can't catch it, because stale
 * rows aren't `undefined`. Switching accounts on the calendar painted the old
 * account's win/loss colours under the new account's name for ~40ms.
 *
 * Tagging the result with the account it was built for makes that detectable:
 * while the tag disagrees this reports `undefined`, which every page's existing
 * `loaded` gate already treats as "still loading".
 *
 * Note this keys ONLY on the account. Month and date navigation don't touch it,
 * so paging the calendar or stepping days on Progress still costs no query and
 * gates nothing — the guard is limited to the account actually changing.
 *
 * CONSTRAINT: `querier` may only close over `accountId` (and module-level
 * values). Like `useLiveQuery`, it is captured when the subscription is
 * created and only replaced when `accountId` changes — a querier reading some
 * other prop or state would keep seeing that value's first version. Anything
 * that varies per render belongs in a `useMemo` over this hook's result, not
 * inside the query.
 *
 * Use it for any account-scoped query whose consumer can wait a frame — i.e.
 * one already gated on `!== undefined`. Two kinds of call site deliberately
 * DON'T use it:
 *
 *  - Lookup maps with an `[]` default and no gate (`StatsFilterBar`'s models,
 *    the name/order maps inside Reports). Reporting `undefined` there doesn't
 *    prevent a wrong render, it just swaps "the other account's names" for "no
 *    names" — neither is right, and the empty case is the more confusing of
 *    the two. `StatsFilterBar`'s symbols already solve it properly, by seeding
 *    from a per-account cache.
 *  - `Day`, which needs the opposite behaviour: it keeps a module cache so
 *    navigating to a preloaded neighbouring day renders instantly, and tags
 *    each result with `forDate`/`forAccount` so a mismatch falls back to that
 *    cache rather than to nothing.
 */
export function useAccountQuery<T>(
  accountId: string,
  querier: () => Promise<T> | T,
): T | undefined {
  const res = useLiveQuery(
    async () => ({ accountId, value: await querier() }),
    [accountId],
  )
  return res && res.accountId === accountId ? res.value : undefined
}
