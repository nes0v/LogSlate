import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { db } from '@/db/schema'
import { createAdjustment, deleteAdjustment } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { formatUsd } from '@/lib/money'

export function BrokerFeesPanel() {
  const accountId = useActiveAccountId()
  const fees = useLiveQuery(
    async () => {
      const rows = await db.adjustments
        .where('[account_id+date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .toArray()
      return rows.filter(a => a.kind === 'fee').reverse()
    },
    [accountId],
    [],
  )

  const [month, setMonth] = useState(() => format(new Date(), 'yyyy-MM'))
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
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError('Invalid month.')
      return
    }
    setError(null)
    await createAdjustment({
      date: `${month}-01`,
      kind: 'fee',
      amount: n,
      note: note.trim(),
    })
    setAmount('')
    setNote('')
  }

  async function handleDelete(id: string) {
    if (confirm('Delete this fee?')) await deleteAdjustment(id)
  }

  const list = fees ?? []
  const total = list.reduce((s, a) => s + a.amount, 0)

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Monthly broker fees</h2>
      <p className="text-sm text-(--color-text-dim)">
        Recurring broker charges (live data feed, platform, etc.). Posted on
        the 1st of the chosen month and subtracted from equity, but kept out
        of the deposits/withdrawals view.
      </p>

      <form
        onSubmit={handleSubmit}
        className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 grid grid-cols-[auto_1fr_1fr_auto] gap-3 items-end"
      >
        <label className="text-xs text-(--color-text-dim) space-y-2">
          <div>Month</div>
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs text-(--color-text-dim) space-y-2">
          <div>Amount (USD)</div>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="15"
            className={inputClass}
          />
        </label>
        <label className="text-xs text-(--color-text-dim) space-y-2">
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
          className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded-(--radius) border border-transparent bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90"
        >
          Add
        </button>
        {error && <div className="col-span-4 text-xs text-(--color-loss)">{error}</div>}
      </form>

      {list.length > 0 && (
        <>
          <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) divide-y divide-(--color-border)">
            {list.map(a => (
              <div
                key={a.id}
                className="grid grid-cols-[auto_auto_1fr_auto] gap-3 items-center px-3 py-2"
              >
                <span className="text-xs font-mono tabular-nums text-(--color-text-dim)">
                  {a.date.slice(0, 7)}
                </span>
                <span className="text-sm font-mono font-medium tabular-nums text-(--color-loss)">
                  -{formatUsd(a.amount)}
                </span>
                <span className="text-xs text-(--color-text-dim) truncate" title={a.note}>
                  {a.note}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  aria-label="Delete fee"
                  className="p-1 rounded-(--radius) text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="text-xs text-(--color-text-dim) font-mono">
            {list.length} fee{list.length === 1 ? '' : 's'} · total{' '}
            <span className="text-(--color-loss)">-{formatUsd(total)}</span>
          </div>
        </>
      )}
    </section>
  )
}
