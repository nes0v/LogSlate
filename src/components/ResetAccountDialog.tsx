import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Account } from '@/db/types'
import type { AccountResetContext } from '@/db/queries'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { DatePicker } from '@/components/form/DatePicker'
import { NumberInput } from '@/components/form/NumberInput'
import { BTN_BASE, BTN_GHOST } from '@/components/form/buttonClass'
import { accountEquityThrough } from '@/lib/day-pnl'
import { formatUsd } from '@/lib/money'
import { formatDisplayDate, nyToday, previousWeekdayKey } from '@/lib/tz'
import { cn } from '@/lib/utils'

interface ResetAccountDialogProps {
  account: Account
  /** The account's history, or `undefined` while it loads — the preview line
   *  waits rather than quoting a wrong step. Held as raw pieces so changing
   *  the date re-prices locally instead of re-querying. */
  context: AccountResetContext | undefined
  onCancel: () => void
  onConfirm: (newBalance: number, date: string) => void
}

/**
 * Reset confirmation. Not built on `useConfirm()` because that is strictly
 * yes/no and this needs a value back — but it deliberately mirrors the same
 * shell (portal, backdrop dismiss, Escape, focus on open) so the two read as
 * one dialog system.
 *
 * The balance pre-fills to the account's opening capital, which is the answer
 * almost every time: an eval reset puts you back at the size you started.
 */
export function ResetAccountDialog({
  account,
  context,
  onCancel,
  onConfirm,
}: ResetAccountDialogProps) {
  const [balance, setBalance] = useState<number | null>(account.starting_balance)
  // Same default as the deposit/withdraw form: the most recent weekday, since
  // the equity chart's daily timeframe drops weekend buckets entirely.
  const [date, setDate] = useState(() => previousWeekdayKey(nyToday()))
  const inputRef = useRef<HTMLDivElement>(null)

  const valid = balance !== null && Number.isFinite(balance) && balance >= 0

  // Mount-only. Deliberately NOT folded into the Escape effect below: that one
  // depends on `onCancel`, which the parent passes as an inline arrow, so it
  // re-runs on every parent render — and re-running this would re-select the
  // field out from under someone mid-edit.
  useEffect(() => {
    inputRef.current?.querySelector('input')?.select()
  }, [])

  // Escape only. `ConfirmDialog` also confirms on Enter, which is safe there
  // because it is a bare yes/no — here Enter is ambiguous while the date
  // picker's calendar is open, and confirming a balance change by accident is
  // not a mistake worth risking to save one click.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Mirrors `resetAccountBalance`'s own test for "is there history to stay
  // continuous with": `netByDate` is keyed by every trade date AND every
  // override date, so an empty map plus no adjustments is exactly the case
  // where the balance is rewritten outright instead of a row being added.
  const noHistory =
    context !== undefined &&
    context.adjustments.length === 0 &&
    context.netByDate.size === 0

  // What the reset will actually do, spelled out before it happens. The step is
  // the gap between equity at the chosen date and the target — the same number
  // `resolveResets` will derive, so the dialog can't promise something the
  // curve won't do.
  const preview = useMemo(() => {
    if (!valid || context === undefined) return null
    // Without this the dialog promises a step ("adds a reset of +$45,000")
    // that never gets written, because this path silently rewrites the opening
    // balance instead.
    if (noHistory) {
      return `Nothing is logged on this account yet, so its starting balance is set to ${formatUsd(
        balance,
      )} — no reset is recorded.`
    }
    // Measured at the END of the chosen date, so a back-dated reset is priced
    // against what equity actually was that evening — not against today.
    const equity = accountEquityThrough(
      date,
      context.netByDate,
      context.adjustments,
      context.startingBalance,
    )
    const step = balance - equity
    // Back-dating changes the tense: the number quoted is equity as it stood at
    // the close of the chosen day, which for any past date is not "now".
    const latest = date === previousWeekdayKey(nyToday())
    const where = latest
      ? `Equity is ${formatUsd(equity)} now`
      : `Equity was ${formatUsd(equity)} on ${formatDisplayDate(date)}`
    if (Math.abs(step) < 0.005) {
      return `${where}. This records a reset that moves nothing.`
    }
    return `${where}. This adds a reset of ${
      step > 0 ? '+' : '−'
    }${formatUsd(Math.abs(step))}.`
  }, [valid, balance, date, context, noHistory])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} aria-hidden />
      <div className="relative w-full max-w-sm rounded-(--radius) bg-(--color-panel) p-5 space-y-4">
        <h2 id="reset-title" className="text-base font-medium text-(--color-text)">
          Reset &ldquo;{account.name}&rdquo;
        </h2>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="text-xs text-(--color-text-dim) space-y-2">
            <div>Date</div>
            <DatePicker
              value={date}
              onChange={v => v && setDate(v)}
              compact
              disableWeekends
              ariaLabel="Reset date"
            />
          </div>
          <label className="text-xs text-(--color-text-dim) space-y-2 flex-1 min-w-[7rem]">
            <div>New balance (USD)</div>
            <div ref={inputRef}>
              <NumberInput
                value={balance}
                onChange={setBalance}
                placeholder="50000"
                className={inputClass}
              />
            </div>
          </label>
        </div>

        {/* Reserve the line's height either way so confirming doesn't shift
            under the pointer as the preview resolves. */}
        <p className="text-sm text-(--color-text-dim) min-h-[2.5rem]">
          {preview ?? ' '}
        </p>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className={BTN_GHOST}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || context === undefined}
            onClick={() => valid && onConfirm(balance, date)}
            className={cn(
              BTN_BASE,
              'font-medium hover:opacity-90',
              'bg-(--color-accent) text-(--color-accent-fg)',
            )}
          >
            Reset
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
