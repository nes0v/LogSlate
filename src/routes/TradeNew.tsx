import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { TradeForm } from '@/components/TradeForm'
import { createTrade } from '@/db/queries'
import { nyToday } from '@/lib/tz'
import type { TradeDraft } from '@/db/types'

export function TradeNewRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null
  // `||` alone would let a malformed but non-empty param (e.g. ?date=foo)
  // reach parseISO below and throw on format() → ErrorBoundary. Require a
  // real YYYY-MM-DD, else fall back to today.
  const rawDate = params.get('date')
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : nyToday()

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
