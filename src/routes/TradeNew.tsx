import { useNavigate, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { TradeForm } from '@/components/TradeForm'
import { db } from '@/db/schema'
import { createTrade } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import type { TradeDraft } from '@/db/types'

export function TradeNewRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const accountId = useActiveAccountId()
  const date = params.get('date') || format(new Date(), 'yyyy-MM-dd')

  async function handleSubmit(draft: TradeDraft) {
    await createTrade(draft)
    navigate(`/day/${draft.trade_date}`)
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
        onCancel={() => navigate(`/day/${date}`)}
        submitLabel="Save trade"
        requireEmotion
        getTradeOrdinal={async () => {
          const count = await db.trades
            .where('[account_id+trade_date]')
            .equals([accountId, date])
            .count()
          return count + 1
        }}
      />
    </div>
  )
}
