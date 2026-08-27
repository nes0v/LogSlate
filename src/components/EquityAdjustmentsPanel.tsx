import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { createAdjustment, deleteAdjustment } from '@/db/queries'
import type { AdjustmentKind, EquityAdjustment } from '@/db/types'
import { ADJUSTMENT_KIND_COLOR } from '@/db/types'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { DatePicker } from '@/components/form/DatePicker'
import { NumberInput } from '@/components/form/NumberInput'
import { Pills } from '@/components/form/Pills'
import { Switch } from '@/components/form/Switch'
import { BTN_ACCENT } from '@/components/form/buttonClass'
import { setChartAdjustmentPref, useChartAdjustmentPrefs } from '@/lib/chart-adjustment-prefs'
import { formatUsd } from '@/lib/money'
import { formatDisplayDate, nyToday, previousWeekdayKey } from '@/lib/tz'
import { cn } from '@/lib/utils'

interface EquityAdjustmentsPanelProps {
  /** All adjustments for the active account; this panel filters out
   *  `fee` rows internally (those live in BrokerFeesPanel). */
  adjustments: EquityAdjustment[]
}

export function EquityAdjustmentsPanel({ adjustments }: EquityAdjustmentsPanelProps) {
  const confirm = useConfirm()
  const markerPrefs = useChartAdjustmentPrefs()
  const list = useMemo(
    () => adjustments.filter(a => a.kind !== 'fee').slice().reverse(),
    [adjustments],
  )

  // Cash-flow dates must land on a trading day (weekend dates get dropped from
  // the daily equity candles), so default to the most recent weekday.
  const [date, setDate] = useState(() => previousWeekdayKey(nyToday()))
  const [kind, setKind] = useState<AdjustmentKind>('deposit')
  const [amount, setAmount] = useState<number | null>(null)
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
    await createAdjustment({ date, kind, amount, note: '' })
    setAmount(null)
  }

  async function handleDelete(id: string) {
    if (await confirm({ title: 'Delete this adjustment?' })) await deleteAdjustment(id)
  }

  // Resets are excluded from these totals on purpose: no money moved, so
  // folding a reset in would overstate what was actually deposited.
  const totalDeposits = list
    .filter(a => a.kind === 'deposit')
    .reduce((s, a) => s + a.amount, 0)
  const totalWithdraws = list
    .filter(a => a.kind === 'withdraw')
    .reduce((s, a) => s + a.amount, 0)
  const net = totalDeposits - totalWithdraws
  const resetCount = list.filter(a => a.kind === 'reset').length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-(--color-text-dim)">
          These show up on the equity curve but don&rsquo;t affect trade stats.
        </p>
        <Switch
          checked={markerPrefs.deposits}
          onChange={v => setChartAdjustmentPref('deposits', v)}
          label="Show on chart"
          ariaLabel="Show deposit & withdrawal markers on the equity chart"
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-(--color-panel-2) rounded-(--radius) p-3 flex flex-wrap gap-3 items-end"
      >
        <div className="text-xs text-(--color-text-dim) space-y-2">
          <div>Date</div>
          <DatePicker
            value={date}
            onChange={v => v && setDate(v)}
            compact
            disableWeekends
            ariaLabel="Adjustment date"
          />
        </div>
        <div className="text-xs text-(--color-text-dim) space-y-2">
          <div>Type</div>
          <Pills
            value={kind}
            onChange={v => setKind(v as AdjustmentKind)}
            options={[
              { value: 'deposit', label: 'Deposit' },
              { value: 'withdraw', label: 'Withdraw' },
            ]}
            activeBgClass="bg-(--color-panel-2)"
          />
        </div>
        {/* Grows into the leftover space on a wide row, but has a floor so it
            wraps to its own line instead of being crushed on a phone. */}
        <label className="text-xs text-(--color-text-dim) space-y-2 flex-1 min-w-[7rem]">
          <div>Amount (USD)</div>
          <NumberInput
            value={amount}
            onChange={setAmount}
            placeholder="1000"
            className={inputClass}
          />
        </label>
        <button type="submit" className={BTN_ACCENT}>
          Add
        </button>
        {error && <div className="w-full text-xs text-(--color-loss)">{error}</div>}
      </form>

      {list.length > 0 && (
        <>
          <div className="bg-(--color-panel-2) rounded-(--radius) overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {list.map(a => (
                <tr
                  key={a.id}
                  className="border-t border-(--color-panel) first:border-t-0 hover:bg-(--color-panel-3)/60"
                >
                  <td className="px-3 py-2 text-xs font-mono tabular-nums text-(--color-text-dim) whitespace-nowrap">
                    {formatDisplayDate(a.date)}
                  </td>
                  {/* The flexible cell between a nowrap date and a fixed-width
                      action, so right-aligning here columns the amounts up
                      against the delete button. Colour comes from the shared
                      kind map, and the prefix carries the meaning now that the
                      kind label is gone: + in, − out, → set to. A reset's
                      amount is a target balance, so it takes no sign. */}
                  <td
                    className="px-3 py-2 font-mono font-medium tabular-nums whitespace-nowrap text-right"
                    style={{ color: ADJUSTMENT_KIND_COLOR[a.kind] }}
                  >
                    {a.kind === 'deposit' ? '+' : a.kind === 'reset' ? '→ ' : '−'}
                    {formatUsd(a.amount)}
                  </td>
                  <td className="px-3 py-2 w-10 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      aria-label="Delete adjustment"
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
            {list.length} adjustment{list.length === 1 ? '' : 's'}
            {resetCount > 0 && ` (${resetCount} reset${resetCount === 1 ? '' : 's'})`} · deposits{' '}
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
    </div>
  )
}
