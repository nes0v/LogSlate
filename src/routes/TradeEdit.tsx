import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { TradeForm } from '@/components/TradeForm'
import { useConfirm } from '@/components/ConfirmDialog'
import { db } from '@/db/schema'
import { deleteTrade, getTrade, listAllTrades, updateTrade } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { recordToForm, type TradeFormValues } from '@/lib/form-schema'
import type { TradeDraft, TradeRecord } from '@/db/types'

export function TradeEditRoute() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
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
      const rows = await listAllTrades(accountId)
      rows.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1
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
  }

  async function handleDelete() {
    if (state.status !== 'ready') return
    if (!(await confirm({ title: 'Delete this trade?' }))) return
    await deleteTrade(id)
    navigate(`/day/${state.record.date}`)
  }

  // Treat "we have a record but it's for a different id" as still loading.
  // Without this guard, navigating between trades shows the previous trade's
  // form values (stale state propagates into TradeForm's initialValues, and
  // react-hook-form pins those defaults for the lifetime of the mount).
  const stale = state.status === 'ready' && state.record.id !== id
  const ready = state.status === 'ready' && !stale
  const record = ready ? state.record : null

  if (state.status === 'not-found') {
    return (
      <div>
        <h1 className="text-lg font-semibold mb-2">Trade not found</h1>
        <Link to="/" className="text-(--color-accent) underline">Back to calendar</Link>
      </div>
    )
  }

  return (
    <div className="pt-1 space-y-8">
      {/* Header renders immediately — same shape regardless of load state.
          The date and delete button stay visible (delete just no-ops
          until the record resolves) so the page doesn't flash a "Loading…"
          stub before snapping to the real layout. */}
      <PageHeader
        back
        title="Edit trade"
        prev={prevId ? `/trade/${prevId}/edit` : null}
        next={nextId ? `/trade/${nextId}/edit` : null}
        prevLabel="Previous trade"
        nextLabel="Next trade"
        rightSlot={
          <div className="flex items-center gap-3">
            <span className="text-sm text-(--color-text-dim) font-mono">
              {record ? format(parseISO(record.date), 'MMM d, yyyy') : ' '}
            </span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!record}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-(--radius) border border-(--color-border) text-(--color-text-dim) hover:text-(--color-loss) disabled:opacity-50 transition-colors"
            >
              <Trash2 className="size-4" /> Delete
            </button>
          </div>
        }
      />
      {ready && record ? (
        <TradeForm
          key={id}
          initialValues={state.values}
          initialDate={record.date}
          onSubmit={handleSubmit}
          onCancel={() => navigate(`/day/${record.date}`)}
          getTradeOrdinal={async () => {
            const rows = await db.trades
              .where('[account_id+date]')
              .equals([accountId, record.date])
              .sortBy('created_at')
            const idx = rows.findIndex(t => t.id === id)
            return idx >= 0 ? idx + 1 : rows.length + 1
          }}
          onScreenshotPersist={ref => updateTrade(id, { screenshot: ref })}
        />
      ) : null}
    </div>
  )
}
