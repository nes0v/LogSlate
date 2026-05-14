import { useMemo, useRef, useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { nyMonthKey } from '@/lib/tz'
import { useOutsideClick } from '@/lib/use-outside-click'
import { cn } from '@/lib/utils'

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

interface MonthPickerProps {
  /** YYYY-MM or null/empty for unselected. */
  value: string | null
  onChange: (v: string | null) => void
  placeholder?: string
  className?: string
  /** Show a "Clear" footer button (only emits null when this is true). */
  clearable?: boolean
  /** Tighter trigger padding for dense rows. */
  compact?: boolean
  ariaLabel?: string
}

function parseYearMonth(v: string | null): { year: number; month: number } | null {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})$/.exec(v)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]) - 1 }
}

export function MonthPicker({
  value,
  onChange,
  placeholder = 'Select month',
  className,
  clearable = false,
  compact = false,
  ariaLabel,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false)
  const today = useMemo(() => parseYearMonth(nyMonthKey())!, [])
  const [viewYear, setViewYear] = useState<number>(
    () => parseYearMonth(value)?.year ?? today.year,
  )
  const ref = useRef<HTMLDivElement>(null)

  useOutsideClick(ref, open, () => setOpen(false))

  function toggle() {
    if (!open) {
      const s = parseYearMonth(value)
      setViewYear(s?.year ?? today.year)
    }
    setOpen(o => !o)
  }

  const selected = parseYearMonth(value)
  const display = selected
    ? `${MONTHS_SHORT[selected.month]} ${selected.year}`
    : placeholder

  function pick(monthIdx: number) {
    const mm = String(monthIdx + 1).padStart(2, '0')
    onChange(`${viewYear}-${mm}`)
    setOpen(false)
  }

  const triggerClass = cn(
    'w-full h-8 flex items-center justify-between gap-2 text-sm rounded-(--radius)',
    'bg-(--color-bg) text-(--color-text) cursor-pointer transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-(--color-accent-soft)',
    compact ? 'pl-2 pr-2' : 'pl-2.5 pr-2',
  )

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={ariaLabel}
        className={triggerClass}
      >
        <span
          className={cn(
            'truncate',
            !selected && 'text-(--color-text-faint)',
          )}
        >
          {display}
        </span>
        <CalendarIcon className="size-4 shrink-0 text-(--color-text-dim)" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[244px] bg-(--color-panel) border border-(--color-border-strong) rounded-(--radius) p-2">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewYear(y => y - 1)}
              className="p-1 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
              aria-label="Previous year"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-sm font-medium">{viewYear}</div>
            <button
              type="button"
              onClick={() => setViewYear(y => y + 1)}
              className="p-1 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
              aria-label="Next year"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-0.5">
            {MONTHS_FULL.map((label, i) => {
              const isSelected =
                selected !== null &&
                selected.year === viewYear &&
                selected.month === i
              const isCurrent = today.year === viewYear && today.month === i
              return (
                <button
                  type="button"
                  key={label}
                  onClick={() => pick(i)}
                  className={cn(
                    'h-9 rounded text-xs flex items-center justify-center transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-(--color-accent) text-(--color-accent-fg) font-medium'
                      : 'text-(--color-text) hover:bg-(--color-panel-2)',
                    !isSelected && isCurrent && 'ring-1 ring-(--color-accent-soft)',
                  )}
                >
                  {MONTHS_SHORT[i]}
                </button>
              )
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-(--color-border) flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                onChange(nyMonthKey())
                setOpen(false)
              }}
              className="px-2 py-1 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
            >
              This month
            </button>
            {clearable && value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className="px-2 py-1 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
