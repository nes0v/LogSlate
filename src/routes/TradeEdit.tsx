import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { TradeForm } from '@/components/TradeForm'
import { useConfirm } from '@/components/ConfirmDialog'
import { deleteTrade, getTrade, updateTrade } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { recordToForm, type TradeFormValues } from '@/lib/form-schema'
import { BTN_BASE } from '@/components/form/buttonClass'
import { errorMessage } from '@/lib/utils'
import type { TradeDraft, TradeRecord } from '@/db/types'

export function TradeEditRoute() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null
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

  // Switching accounts while viewing a trade leaves the URL pinned to a
  // foreign id. Bounce back to the calendar root so the user lands in the
  // newly-active account's context instead of seeing a trade that isn't
  // theirs.
  useEffect(() => {
    if (state.status !== 'ready') return
    if (state.record.account_id !== accountId) {
      navigate('/', { replace: true })
    }
  }, [state, accountId, navigate])

  async function handleSubmit(draft: TradeDraft) {
    try {
      await updateTrade(id, draft)
    } catch (e) {
      alert(errorMessage(e))
    }
  }

  async function handleDelete() {
    if (state.status !== 'ready') return
    if (!(await confirm({ title: 'Delete this trade?' }))) return
    try {
      await deleteTrade(id)
      navigate(`/day/${state.record.date}`)
    } catch (e) {
      alert(`Failed to delete trade: ${errorMessage(e)}`)
    }
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
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Edit trade</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-(--color-text-dim) font-mono">
            {record ? format(parseISO(record.date), 'MMM d, yyyy') : ' '}
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!record}
            className={`${BTN_BASE} border border-(--color-border) text-(--color-text-dim) hover:text-(--color-loss) disabled:opacity-50 transition-colors`}
          >
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      </div>
      {ready && record ? (
        <TradeForm
          key={id}
          initialValues={state.values}
          initialDate={record.date}
          original={{ symbol_id: record.symbol_id, symbol_spec: record.symbol_spec }}
          onSubmit={handleSubmit}
          onCancel={() => navigate(cameFrom ?? `/day/${record.date}`)}
        />
      ) : null}
    </div>
  )
}
