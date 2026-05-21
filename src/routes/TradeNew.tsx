import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { PageHeader } from '@/components/PageHeader'
import { TradeForm } from '@/components/TradeForm'
import { db } from '@/db/schema'
import { createTrade } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { nyToday } from '@/lib/tz'
import type { TradeDraft } from '@/db/types'

export function TradeNewRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null
  const accountId = useActiveAccountId()
  const date = params.get('date') || nyToday()

  async function handleSubmit(draft: TradeDraft) {
    await createTrade(draft)
    navigate(`/day/${draft.date}`)
  }

  return (
    <div className="pt-1 space-y-8">
      <PageHeader
        back
        title="New trade"
        rightSlot={
          <span className="text-sm text-(--color-text-dim) font-mono">
            {format(parseISO(date), 'MMM d, yyyy')}
          </span>
        }
      />
      <TradeForm
        initialDate={date}
        onSubmit={handleSubmit}
        onCancel={() => navigate(cameFrom ?? `/day/${date}`)}
        getTradeOrdinal={async () => {
          const count = await db.trades
            .where('[account_id+date]')
            .equals([accountId, date])
            .count()
          return count + 1
        }}
      />
    </div>
  )
}
