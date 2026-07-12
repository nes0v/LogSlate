import { useMemo, useRef, useState } from 'react'
import {
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  isWeekend,
  startOfMonth,
  subMonths,
} from 'date-fns'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { monthDayGrid } from '@/lib/calendar-grid'
import { dateKeyToDate, formatDisplayDate, nyToday } from '@/lib/tz'
import { useOutsideClick } from '@/lib/use-outside-click'
import { cn } from '@/lib/utils'

const DATE_KEY = 'yyyy-MM-dd'
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function viewMonthFor(value: string | null): Date {
  return startOfMonth(value ? dateKeyToDate(value) : new Date())
}

interface DatePickerProps {
  /** YYYY-MM-DD or null/empty for unselected. */
  value: string | null
  onChange: (v: string | null) => void
  /** Shown when no date is selected. */
  placeholder?: string
  /** Outer container class — typically used to set width (e.g. `w-[135px]`). */
  className?: string
  /** Show a "Clear" footer button (only emits null when this is true). */
  clearable?: boolean
  /** Tighter trigger padding for dense rows (matches `inputClassCompact`). */
  compact?: boolean
  /** Grey out and block Saturday/Sunday cells (and the Today shortcut when
   *  today is a weekend). Used for cash-flow dates, which must land on a
   *  trading day so they aren't dropped from the daily equity candles. */
  disableWeekends?: boolean
  ariaLabel?: string
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  className,
  clearable = false,
  compact = false,
  disableWeekends = false,
  ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  // Calendar's currently-displayed month. Re-synced on each open so the
  // user always lands on the selected month if there is one.
  const [viewMonth, setViewMonth] = useState<Date>(() => viewMonthFor(value))
  const ref = useRef<HTMLDivElement>(null)

  useOutsideClick(ref, open, () => setOpen(false))

  function toggle() {
    if (!open) setViewMonth(viewMonthFor(value))
    setOpen(o => !o)
  }

  const selectedDate = value ? dateKeyToDate(value) : null
  const todayKey = nyToday()

  // When weekends are excluded, drop the Sat/Sun cells entirely and lay the
  // grid out as 5 weekday columns. The Sunday-first grid is contiguous
  // Sun…Sat per row, so filtering weekends leaves each row's Mon…Fri in order.
  const days = useMemo(() => {
    const all = monthDayGrid(viewMonth).days
    return disableWeekends ? all.filter(d => !isWeekend(d)) : all
  }, [viewMonth, disableWeekends])
  const weekdayInitials = disableWeekends
    ? ['M', 'T', 'W', 'T', 'F']
    : WEEKDAY_INITIALS
  const gridCols = disableWeekends ? 'grid-cols-5' : 'grid-cols-7'

  function pick(d: Date) {
    onChange(format(d, DATE_KEY))
    setOpen(false)
  }

  const display = selectedDate ? formatDisplayDate(selectedDate) : placeholder

  // Trigger mirrors the recessed-input look (`bg-(--color-bg)`, no border,
  // accent-soft focus ring) used by FilterDropdown — matching height, font,
  // and chevron weight so date pickers read as the same control vocabulary.
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
            !selectedDate && 'text-(--color-text-faint)',
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
              onClick={() => setViewMonth(m => subMonths(m, 1))}
              className="p-1 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-sm font-medium">
              {format(viewMonth, 'MMMM yyyy')}
            </div>
            <button
              type="button"
              onClick={() => setViewMonth(m => addMonths(m, 1))}
              className="p-1 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className={cn('grid mb-1', gridCols)}>
            {weekdayInitials.map((wd, i) => (
              <div
                key={i}
                className="text-center text-[10px] uppercase tracking-wide text-(--color-text-faint) py-1"
              >
                {wd}
              </div>
            ))}
          </div>
          <div className={cn('grid gap-0.5', gridCols)}>
            {days.map(d => {
              const key = format(d, DATE_KEY)
              const inMonth = isSameMonth(d, viewMonth)
              const isSelected = selectedDate
                ? isSameDay(d, selectedDate)
                : false
              const isToday = key === todayKey
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => pick(d)}
                  className={cn(
                    'h-7 rounded text-xs flex items-center justify-center transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-(--color-accent) text-(--color-accent-fg) font-medium'
                      : inMonth
                        ? 'text-(--color-text) hover:bg-(--color-panel-2)'
                        : 'text-(--color-text-faint) hover:bg-(--color-panel-2)',
                    !isSelected && isToday && 'ring-1 ring-(--color-accent-soft)',
                  )}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-(--color-border) flex items-center justify-between text-xs">
            <button
              type="button"
              disabled={disableWeekends && isWeekend(dateKeyToDate(todayKey))}
              onClick={() => {
                onChange(todayKey)
                setOpen(false)
              }}
              className="px-2 py-1 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-(--color-text-dim)"
            >
              Today
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
