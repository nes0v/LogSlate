import { useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { TradeForm } from '@/components/TradeForm'
import { createTrade } from '@/db/queries'
import type { TradeDraft } from '@/db/types'

export function TradeNewRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const date = params.get('date') || format(new Date(), 'yyyy-MM-dd')

  async function handleSubmit(draft: TradeDraft) {
    await createTrade(draft)
    navigate(`/day/${draft.trade_date}`)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">New trade</h1>
      <TradeForm
        initialDate={date}
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/day/${date}`)}
        submitLabel="Save trade"
      />
    </div>
  )
}
