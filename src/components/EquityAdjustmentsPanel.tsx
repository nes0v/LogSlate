import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { db } from '@/db/schema'
import { createAdjustment, deleteAdjustment } from '@/db/queries'
import type { AdjustmentKind } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

const inputClass =
  'w-full rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1.5 text-sm outline-none focus:border-(--color-accent)'

export function EquityAdjustmentsPanel() {
  const accountId = useActiveAccountId()
  const adjustments = useLiveQuery(
    async () => {
      const rows = await db.adjustments
        .where('[account_id+date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .toArray()
      return rows.reverse()
    },
    [accountId],
    [],
  )

  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [kind, setKind] = useState<AdjustmentKind>('deposit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) {
      setError('Amount must be a positive number.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Invalid date.')
      return
    }
    setError(null)
    await createAdjustment({ date, kind, amount: n, note: note.trim() })
    setAmount('')
    setNote('')
  }

  async function handleDelete(id: string) {
    if (confirm('Delete this adjustment?')) await deleteAdjustment(id)
  }

  const list = adjustments ?? []
  const totalDeposits = list
    .filter(a => a.kind === 'deposit')
    .reduce((s, a) => s + a.amount, 0)
  const totalWithdraws = list
    .filter(a => a.kind === 'withdraw')
    .reduce((s, a) => s + a.amount, 0)
  const net = totalDeposits - totalWithdraws

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Deposits &amp; withdrawals</h2>
      <p className="text-sm text-(--color-text-dim)">
        Cash in/out of the trading account. Deposits grow equity, withdrawals shrink it.
        These show up on the equity curve but don&rsquo;t affect trade stats.
      </p>

      <form
        onSubmit={handleSubmit}
        className="bg-(--color-panel) border border-(--color-border) rounded-md p-3 grid grid-cols-[auto_auto_1fr_1fr_auto] gap-3 items-end"
      >
        <label className="text-xs text-(--color-text-dim) space-y-1">
          <div>Date</div>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs text-(--color-text-dim) space-y-1">
          <div>Type</div>
          <select
            value={kind}
            onChange={e => setKind(e.target.value as AdjustmentKind)}
            className={inputClass}
          >
            <option value="deposit">Deposit</option>
            <option value="withdraw">Withdraw</option>
          </select>
        </label>
        <label className="text-xs text-(--color-text-dim) space-y-1">
          <div>Amount (USD)</div>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="1000"
            className={inputClass}
          />
        </label>
        <label className="text-xs text-(--color-text-dim) space-y-1">
          <div>Note (optional)</div>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded-md bg-(--color-accent) text-white hover:opacity-90"
        >
          Add
        </button>
        {error && <div className="col-span-5 text-xs text-(--color-loss)">{error}</div>}
      </form>

      {list.length > 0 && (
        <>
          <div className="bg-(--color-panel) border border-(--color-border) rounded-md divide-y divide-(--color-border)">
            {list.map(a => (
              <div
                key={a.id}
                className="grid grid-cols-[auto_auto_auto_1fr_auto] gap-3 items-center px-3 py-2"
              >
                <span className="text-xs font-mono tabular-nums text-(--color-text-dim)">
                  {a.date}
                </span>
                <span
                  className={cn(
                    'text-xs font-mono px-2 py-0.5 rounded-sm',
                    a.kind === 'deposit'
                      ? 'bg-(--color-win)/20 text-(--color-win)'
                      : 'bg-(--color-loss)/20 text-(--color-loss)',
                  )}
                >
                  {a.kind}
                </span>
                <span
                  className={cn(
                    'text-sm font-mono font-medium tabular-nums',
                    a.kind === 'deposit' ? 'text-(--color-win)' : 'text-(--color-loss)',
                  )}
                >
                  {a.kind === 'deposit' ? '+' : '-'}
                  {formatUsd(a.amount)}
                </span>
                <span className="text-xs text-(--color-text-dim) truncate" title={a.note}>
                  {a.note}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  aria-label="Delete adjustment"
                  className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="text-xs text-(--color-text-dim) font-mono">
            {list.length} adjustment{list.length === 1 ? '' : 's'} · deposits{' '}
            {formatUsd(totalDeposits)} · withdrawals {formatUsd(totalWithdraws)} · net{' '}
            <span
              className={cn(
                net > 0 && 'text-(--color-win)',
                net < 0 && 'text-(--color-loss)',
              )}
            >
              {formatUsd(net)}
            </span>
          </div>
        </>
      )}
    </section>
  )
}
