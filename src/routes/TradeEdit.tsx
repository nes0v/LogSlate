import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { TradeForm } from '@/components/TradeForm'
import { deleteTrade, getTrade, updateTrade } from '@/db/queries'
import { recordToForm, type TradeFormValues } from '@/lib/form-schema'
import type { TradeDraft, TradeRecord } from '@/db/types'

export function TradeEditRoute() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; record: TradeRecord; values: TradeFormValues }
    | { status: 'not-found' }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rec = await getTrade(id)
      if (cancelled) return
      if (!rec) setState({ status: 'not-found' })
      else setState({ status: 'ready', record: rec, values: recordToForm(rec) })
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  async function handleSubmit(draft: TradeDraft) {
    await updateTrade(id, draft)
    navigate(`/day/${draft.trade_date}`)
  }

  async function handleDelete() {
    if (state.status !== 'ready') return
    if (!confirm('Delete this trade?')) return
    await deleteTrade(id)
    navigate(`/day/${state.record.trade_date}`)
  }

  if (state.status === 'loading') {
    return <div className="text-(--color-text-dim)">Loading…</div>
  }
  if (state.status === 'not-found') {
    return (
      <div>
        <h1 className="text-lg font-semibold mb-2">Trade not found</h1>
        <Link to="/" className="text-(--color-accent) underline">Back to calendar</Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link
            to={`/day/${state.record.trade_date}`}
            className="p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
            aria-label="Back to day"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">Edit trade</h1>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          className="px-3 py-1.5 text-sm rounded-md border border-(--color-border) text-(--color-loss) hover:bg-(--color-panel-2)"
        >
          Delete
        </button>
      </div>
      <TradeForm
        initialValues={state.values}
        initialDate={state.record.trade_date}
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/day/${state.record.trade_date}`)}
        submitLabel="Save changes"
      />
    </div>
  )
}
