import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { createAdjustment, deleteAdjustment } from '@/db/queries'
import type { AdjustmentKind, EquityAdjustment } from '@/db/types'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { DatePicker } from '@/components/form/DatePicker'
import { NumberInput } from '@/components/form/NumberInput'
import { Select } from '@/components/form/Select'
import { formatUsd } from '@/lib/money'
import { nyToday } from '@/lib/tz'
import { cn } from '@/lib/utils'

interface EquityAdjustmentsPanelProps {
  /** All adjustments for the active account; this panel filters out
   *  `fee` rows internally (those live in BrokerFeesPanel). */
  adjustments: EquityAdjustment[]
}

export function EquityAdjustmentsPanel({ adjustments }: EquityAdjustmentsPanelProps) {
  const confirm = useConfirm()
  const list = useMemo(
    () => adjustments.filter(a => a.kind !== 'fee').slice().reverse(),
    [adjustments],
  )

  const [date, setDate] = useState(() => nyToday())
  const [kind, setKind] = useState<AdjustmentKind>('deposit')
  const [amount, setAmount] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Invalid date.')
      return
    }
    setError(null)
    await createAdjustment({ date, kind, amount, note: note.trim() })
    setAmount(null)
    setNote('')
  }

  async function handleDelete(id: string) {
    if (await confirm({ title: 'Delete this adjustment?' })) await deleteAdjustment(id)
  }

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
        className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 grid grid-cols-[auto_auto_1fr_1fr_auto] gap-3 items-end"
      >
        <div className="text-xs text-(--color-text-dim) space-y-2">
          <div>Date</div>
          <DatePicker
            value={date}
            onChange={v => v && setDate(v)}
            compact
            ariaLabel="Adjustment date"
          />
        </div>
        <label className="text-xs text-(--color-text-dim) space-y-2">
          <div>Type</div>
          <Select
            value={kind}
            onChange={v => v && setKind(v as AdjustmentKind)}
            options={[
              { value: 'deposit', label: 'Deposit' },
              { value: 'withdraw', label: 'Withdraw' },
            ]}
            ariaLabel="Adjustment type"
          />
        </label>
        <label className="text-xs text-(--color-text-dim) space-y-2">
          <div>Amount (USD)</div>
          <NumberInput
            value={amount}
            onChange={setAmount}
            placeholder="1000"
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
        {error && <div className="col-span-5 text-xs text-(--color-loss)">{error}</div>}
      </form>

      {list.length > 0 && (
        <>
          <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) divide-y divide-(--color-border)">
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
                    'inline-block w-[4.5rem] text-center text-xs font-mono px-2 py-0.5 rounded-sm',
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
                  className="p-1 rounded-(--radius) text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)"
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
