import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { setDayFeesOverride, setDayPnlOverride } from '@/db/queries'
import { NumberInput } from '@/components/form/NumberInput'
import { inputClass } from '@/components/form/Field'
import { cn, errorMessage } from '@/lib/utils'

interface DayPnlOverrideSectionProps {
  accountId: string
  date: string // YYYY-MM-DD
  /** Stored net override for this (account, date); null if none. */
  stored: number | null
  /** Stored informational fees for this override day; null if none. */
  storedFees: number | null
}

// Round a money figure to cents so the stored value matches the 2-decimal
// display and never carries float noise into the fees stat / equity math.
const cents = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)

/**
 * Manual net-PNL override for the whole day. When set, this figure REPLACES
 * the sum of the day's trade PNLs in every money/equity statistic — the way
 * a chaotic "tilt"/revenge day gets recorded as one net number instead of
 * logging each trade. Per-trade population stats still read actual trades.
 *
 * Persisted on blur (a single Dexie transaction when the user leaves the
 * field, not on every keystroke) AND flushed on unmount as a backstop — this
 * is a single high-value figure (a whole tilt day's net), so navigating away
 * via the back button before the input blurs must not silently drop it. The
 * local `value` shadows the stored value so typing feels immediate; it
 * re-syncs from `stored` only when the field isn't focused (e.g. sync).
 */
export function DayPnlOverrideSection({
  accountId,
  date,
  stored,
  storedFees,
}: DayPnlOverrideSectionProps) {
  const [value, setValue] = useState<number | null>(stored)
  const [fees, setFees] = useState<number | null>(storedFees)
  const [error, setError] = useState<string | null>(null)
  // Default open on days that already carry an override; collapsed otherwise.
  // Keyed by `date` at the call site, so it re-derives on each day's mount.
  const [open, setOpen] = useState(stored != null)
  const focused = useRef(false)
  // Refs mirror the latest value/stored so the unmount cleanup (which runs
  // with an empty dep array and would otherwise close over first-render
  // values) flushes what's actually on screen against what's actually saved.
  // Synced in an effect rather than during render (react-hooks/refs): the
  // cleanup only reads them after mount, so the post-commit timing is fine.
  const valueRef = useRef(value)
  const storedRef = useRef(stored)
  const feesRef = useRef(fees)
  const storedFeesRef = useRef(storedFees)
  useEffect(() => {
    valueRef.current = value
    storedRef.current = stored
    feesRef.current = fees
    storedFeesRef.current = storedFees
  })

  useEffect(() => {
    if (focused.current) return
    setValue(stored)
    setFees(storedFees)
  }, [stored, storedFees])

  const commit = useCallback(
    async (rawNet: number | null, rawFees: number | null) => {
      const nextNet = cents(rawNet)
      const nextFees = cents(rawFees)
      const netChanged = nextNet !== storedRef.current
      const feesChanged = nextFees !== storedFeesRef.current
      if (!netChanged && !feesChanged) return
      try {
        // Net first: it creates the day row. Clearing the net (null) also
        // drops fees in the DB, so only write fees when a net override stands.
        if (netChanged) await setDayPnlOverride(accountId, date, nextNet)
        if (nextNet != null && feesChanged) {
          await setDayFeesOverride(accountId, date, nextFees)
        }
        setError(null)
      } catch (e) {
        setError(`Couldn't save override: ${errorMessage(e)}`)
      }
    },
    [accountId, date],
  )

  // Flush on unmount: a route change (back button, prev/next-day nav) tears
  // the field down before `onBlur` fires, so commit the latest values here.
  // `commit` early-returns when nothing changed, so an untouched field writes
  // nothing.
  useEffect(() => () => void commit(valueRef.current, feesRef.current), [commit])

  return (
    <details
      className="space-y-2 group"
      open={open}
      onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="text-sm font-medium cursor-pointer text-(--color-text) hover:text-(--color-accent) list-none flex items-center gap-1 transition-colors">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        PNL override
      </summary>
      <div
        className="bg-(--color-panel) rounded-(--radius) p-3 space-y-2"
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          if (!document.hasFocus()) return
          focused.current = false
          void commit(value, fees)
        }}
      >
        <div className="flex items-center gap-3">
          <p className="text-sm text-(--color-text-dim) flex-1">
            Replaces this day's trade PNL in all equity and money stats. Leave
            blank to use the sum of the day's trades.
          </p>
          <NumberInput
            value={value}
            onChange={setValue}
            decimals={2}
            className={cn(inputClass, 'font-mono max-w-[12rem]')}
          />
        </div>
        {value != null && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-(--color-text-dim) flex-1">
              Total broker fees for this day (optional). Informational only —
              it doesn't change the net above, just the fees stat.
            </p>
            <NumberInput
              value={fees}
              // Fees are a cost — clamp to the magnitude so a negative entry
              // adds to the fees total instead of subtracting from it. The
              // field reformats to this absolute value on blur.
              onChange={v => setFees(v == null ? null : Math.abs(v))}
              decimals={2}
              className={cn(inputClass, 'font-mono max-w-[12rem]')}
            />
          </div>
        )}
        {error && <p className="text-xs text-(--color-loss)">{error}</p>}
      </div>
    </details>
  )
}
