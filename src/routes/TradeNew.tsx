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
  const date = params.get('date') || nyToday()

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
