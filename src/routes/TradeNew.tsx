import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { TradeForm } from '@/components/TradeForm'
import { createTrade, getDayPnlOverride } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { nyToday } from '@/lib/tz'
import type { TradeDraft } from '@/db/types'

export function TradeNewRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const accountId = useActiveAccountId()
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null
  // `||` alone would let a malformed but non-empty param (e.g. ?date=foo)
  // reach parseISO below and throw on format() → ErrorBoundary. Require a
  // real YYYY-MM-DD, else fall back to today.
  const rawDate = params.get('date')
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : nyToday()

  // Mutual exclusion: a day with a net-PNL override is logged as that one
  // figure INSTEAD of trades. The Day page already hides its New-trade button
  // for such days, but this route is also reachable by a hand-typed URL — so
  // bounce back to the day (where the override lives) rather than opening a
  // form whose submit `createTrade` would reject. `undefined` while the query
  // is in flight; only redirect once we know an override exists.
  const override = useLiveQuery(() => getDayPnlOverride(accountId, date), [accountId, date])
  if (override != null) {
    return <Navigate to={`/day/${date}`} replace />
  }

  async function handleSubmit(draft: TradeDraft) {
    await createTrade(draft)
    navigate(`/day/${draft.date}`)
  }

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">New trade</h1>
        <span className="text-sm text-(--color-text-dim) font-mono">
          {format(parseISO(date), 'MMM d, yyyy')}
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
