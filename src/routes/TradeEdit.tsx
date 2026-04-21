import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft } from 'lucide-react'
import { TradeForm } from '@/components/TradeForm'
import { NavArrow } from '@/components/NavArrow'
import { db } from '@/db/schema'
import { deleteTrade, getTrade, updateTrade } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { recordToForm, type TradeFormValues } from '@/lib/form-schema'
import type { TradeDraft, TradeRecord } from '@/db/types'

export function TradeEditRoute() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const accountId = useActiveAccountId()
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

  // Every trade id in the active account, ordered chronologically — used to
  // jump to adjacent trades without going back to the day/stats view.
  const orderedIds = useLiveQuery(
    async () => {
      const rows = await db.trades
        .where('[account_id+trade_date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .toArray()
      rows.sort((a, b) => {
        if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? -1 : 1
        return a.created_at < b.created_at ? -1 : 1
      })
      return rows.map(t => t.id)
    },
    [accountId],
    [] as string[],
  )

  const { prevId, nextId } = useMemo(() => {
    const ids = orderedIds ?? []
    const idx = ids.indexOf(id)
    if (idx < 0) return { prevId: null, nextId: null }
    return {
      prevId: idx > 0 ? ids[idx - 1] : null,
      nextId: idx < ids.length - 1 ? ids[idx + 1] : null,
    }
  }, [orderedIds, id])

  useArrowNavigation({
    prev: prevId ? `/trade/${prevId}/edit` : null,
    next: nextId ? `/trade/${nextId}/edit` : null,
    navigate,
  })

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
          <div className="flex items-center gap-1 ml-2">
            <NavArrow
              to={prevId ? `/trade/${prevId}/edit` : null}
              direction="prev"
              label="Previous trade"
            />
            <NavArrow
              to={nextId ? `/trade/${nextId}/edit` : null}
              direction="next"
              label="Next trade"
            />
          </div>
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
        key={id}
        initialValues={state.values}
        initialDate={state.record.trade_date}
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/day/${state.record.trade_date}`)}
        submitLabel="Save changes"
      />
    </div>
  )
}
