import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { TradeForm } from '@/components/TradeForm'
import { createTrade, getDayPnlOverride } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { formatDisplayDate, nyToday } from '@/lib/tz'
import { errorMessage } from '@/lib/utils'
import type { TradeDraft } from '@/db/types'

export function TradeNewRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const accountId = useActiveAccountId()
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null
  // `||` alone would let a malformed but non-empty param (e.g. ?date=foo)
  // reach the date formatter below and render "Invalid Date". Require a
  // real YYYY-MM-DD, else fall back to today.
  const rawDate = params.get('date')
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : nyToday()

  // Mutual exclusion: a day with a net-PNL override is logged as that one
  // figure INSTEAD of trades. The Day page already hides its New-trade button
  // for such days, but this route is also reachable by a hand-typed URL — so
  // bounce back to the day (where the override lives) rather than opening a
  // form whose submit `createTrade` would reject. `undefined` while the query
  // is in flight; only redirect once we know an override exists.
  //
  // Tagged with the account+date it was read for, because this drives a
  // REDIRECT: dexie-react-hooks keeps serving the previous key's value for one
  // render after either changes, and a stale non-null override would bounce the
  // user out of a form for a day that has no override at all. Same guard the
  // Day route uses.
  const overrideResult = useLiveQuery(
    async () => ({
      forAccount: accountId,
      forDate: date,
      value: await getDayPnlOverride(accountId, date),
    }),
    [accountId, date],
  )
  const override =
    overrideResult?.forAccount === accountId && overrideResult?.forDate === date
      ? overrideResult.value
      : undefined
  if (override != null) {
    return <Navigate to={`/day/${date}`} replace />
  }

  async function handleSubmit(draft: TradeDraft) {
    try {
      await createTrade(draft)
    } catch (e) {
      alert(errorMessage(e))
      return
    }
    navigate(`/day/${draft.date}`)
  }

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">New trade</h1>
        <span className="text-sm text-(--color-text-dim) font-mono">
          {formatDisplayDate(date)}
        </span>
      </div>
      <TradeForm
        initialDate={date}
        onSubmit={handleSubmit}
        onCancel={() => navigate(cameFrom ?? `/day/${date}`)}
      />
    </div>
  )
}
