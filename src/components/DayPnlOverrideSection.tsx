import { useEffect, useRef, useState } from 'react'
import { setDayPnlOverride } from '@/db/queries'
import { NumberInput } from '@/components/form/NumberInput'
import { inputClass } from '@/components/form/Field'
import { cn, errorMessage } from '@/lib/utils'

interface DayPnlOverrideSectionProps {
  accountId: string
  date: string // YYYY-MM-DD
  /** Stored override for this (account, date); null if none. */
  stored: number | null
}

/**
 * Manual net-P&L override for the whole day. When set, this figure REPLACES
 * the sum of the day's trade P&Ls in every money/equity statistic — the way
 * a chaotic "tilt"/revenge day gets recorded as one net number instead of
 * logging each trade. Per-trade population stats still read actual trades.
 *
 * Persisted on blur (like the day note) so a single Dexie transaction runs
 * when the user leaves the field, not on every keystroke. The local `value`
 * shadows the stored value so typing feels immediate; it re-syncs from
 * `stored` only when the field isn't focused (e.g. cross-device sync).
 */
export function DayPnlOverrideSection({ accountId, date, stored }: DayPnlOverrideSectionProps) {
  const [value, setValue] = useState<number | null>(stored)
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)

  useEffect(() => {
    if (focused.current) return
    setValue(stored)
  }, [stored])

  async function commit(raw: number | null) {
    // Money figure — round to cents so the stored value matches the 2-decimal
    // display and never carries float noise into equity math.
    const next = raw === null ? null : Math.round(raw * 100) / 100
    if (next === stored) return
    try {
      await setDayPnlOverride(accountId, date, next)
      setError(null)
    } catch (e) {
      setError(`Couldn't save override: ${errorMessage(e)}`)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Net P&amp;L override</h2>
      <div
        className="bg-(--color-panel) rounded-(--radius) p-3 space-y-2"
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          if (!document.hasFocus()) return
          focused.current = false
          void commit(value)
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-(--color-text-dim) text-sm">$</span>
          <NumberInput
            value={value}
            onChange={setValue}
            decimals={2}
            placeholder="e.g. -250.00"
            className={cn(inputClass, 'font-mono max-w-[12rem]')}
          />
          {value !== null && (
            <button
              type="button"
              onClick={() => {
                setValue(null)
                void commit(null)
              }}
              className="text-xs text-(--color-text-dim) hover:text-(--color-text) transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-(--color-text-dim)">
          Replaces this day's trade P&amp;L in all equity and money stats. Leave
          blank to use the sum of the day's trades.
        </p>
        {error && <p className="text-xs text-(--color-loss)">{error}</p>}
      </div>
    </section>
  )
}
