import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { createAdjustment, deleteAdjustment } from '@/db/queries'
import type { EquityAdjustment } from '@/db/types'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { MonthPicker } from '@/components/form/MonthPicker'
import { NumberInput } from '@/components/form/NumberInput'
import { Switch } from '@/components/form/Switch'
import { BTN_ACCENT } from '@/components/form/buttonClass'
import { setChartAdjustmentPref, useChartAdjustmentPrefs } from '@/lib/chart-adjustment-prefs'
import { formatUsd } from '@/lib/money'
import { formatDisplayDate, nextWeekdayKey, nyMonthKey } from '@/lib/tz'

/** First *weekday* of `YYYY-MM`, as a YYYY-MM-DD key. A fee on the 1st would
 *  land on a weekend in some months, and weekend-dated cash flow is dropped
 *  from the daily equity candles — so anchor it to the first trading day. */
function firstWeekdayOfMonth(month: string): string {
  return nextWeekdayKey(`${month}-01`)
}

interface BrokerFeesPanelProps {
  /** All adjustments for the active account; this panel filters for the
   *  `fee` kind internally. */
  adjustments: EquityAdjustment[]
}

export function BrokerFeesPanel({ adjustments }: BrokerFeesPanelProps) {
  const confirm = useConfirm()
  const markerPrefs = useChartAdjustmentPrefs()
  const list = useMemo(
    () => adjustments.filter(a => a.kind === 'fee').slice().reverse(),
    [adjustments],
  )

  const [month, setMonth] = useState(() => nyMonthKey())
  const [amount, setAmount] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (amount === null || !Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number.')
      return
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError('Invalid month.')
      return
    }
    setError(null)
    await createAdjustment({
      date: firstWeekdayOfMonth(month),
      kind: 'fee',
      amount,
      note: note.trim(),
    })
    setAmount(null)
    setNote('')
  }

  async function handleDelete(id: string) {
    if (await confirm({ title: 'Delete this fee?' })) await deleteAdjustment(id)
  }

  const total = list.reduce((s, a) => s + a.amount, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-(--color-text-dim)">
          Recurring broker charges (live data feed, platform, etc.).
        </p>
        <Switch
          checked={markerPrefs.fees}
          onChange={v => setChartAdjustmentPref('fees', v)}
          label="Show on chart"
          ariaLabel="Show fee markers on the equity chart"
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-(--color-panel-2) rounded-(--radius) p-3 grid grid-cols-[auto_1fr_1fr_auto] gap-3 items-end"
      >
        <div className="text-xs text-(--color-text-dim) space-y-2">
          <div>Month</div>
          <MonthPicker
            value={month}
            onChange={v => v && setMonth(v)}
            compact
            ariaLabel="Fee month"
          />
        </div>
        <label className="text-xs text-(--color-text-dim) space-y-2">
          <div>Amount (USD)</div>
          <NumberInput
            value={amount}
            onChange={setAmount}
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
        <button type="submit" className={BTN_ACCENT}>
          Add
        </button>
        {error && <div className="col-span-4 text-xs text-(--color-loss)">{error}</div>}
      </form>

      {list.length > 0 && (
        <>
          <div className="bg-(--color-panel-2) rounded-(--radius) overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {list.map(a => (
                  <tr
                    key={a.id}
                    className="transition-colors duration-300 ease-out border-t border-(--color-panel) first:border-t-0 hover:bg-(--color-panel-3)/60"
                  >
                    <td className="px-3 py-2 text-xs font-mono tabular-nums text-(--color-text-dim) whitespace-nowrap">
                      {formatDisplayDate(a.date)}
                    </td>
                    <td className="px-3 py-2 font-mono font-medium tabular-nums text-(--color-loss) whitespace-nowrap">
                      -{formatUsd(a.amount)}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-(--color-text-dim) max-w-0 truncate"
                      title={a.note}
                    >
                      {a.note}
                    </td>
                    <td className="px-3 py-2 w-10 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id)}
                        aria-label="Delete fee"
                        className="p-1 rounded-(--radius) text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-3)"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-(--color-text-dim) font-mono">
            {list.length} fee{list.length === 1 ? '' : 's'} · total{' '}
            <span className="text-(--color-loss)">-{formatUsd(total)}</span>
          </div>
        </>
      )}
    </div>
  )
}
