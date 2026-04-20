import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createAdjustment } from '@/db/queries'
import type { AdjustmentKind } from '@/db/types'
import { cn } from '@/lib/utils'

const inputClass =
  'w-full rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1.5 text-sm outline-none focus:border-(--color-accent)'

interface AdjustmentDialogProps {
  onClose: () => void
  /** Default date (YYYY-MM-DD) pre-filled in the form. */
  defaultDate: string
}

// Parent should conditionally mount this component (`{open && <Dialog ... />}`)
// so each open cycle is a fresh React instance with reset form state.
export function AdjustmentDialog({ onClose, defaultDate }: AdjustmentDialogProps) {
  const [date, setDate] = useState(defaultDate)
  const [kind, setKind] = useState<AdjustmentKind>('deposit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    setSaving(true)
    try {
      await createAdjustment({ date, kind, amount: n, note: note.trim() })
      onClose()
    } catch (err) {
      setError((err as Error).message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-(--color-panel) border border-(--color-border) rounded-md w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--color-border)">
          <h2 className="text-sm font-medium">Add deposit or withdrawal</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-(--color-text-dim) space-y-1">
              <div>Date</div>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={inputClass}
                autoFocus
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
          </div>
          <label className="text-xs text-(--color-text-dim) space-y-1 block">
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
          <label className="text-xs text-(--color-text-dim) space-y-1 block">
            <div>Note (optional)</div>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              className={inputClass}
            />
          </label>
          {error && <div className="text-xs text-(--color-loss)">{error}</div>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md bg-(--color-accent) text-white hover:opacity-90',
                saving && 'opacity-50',
              )}
            >
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
