import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilterDropdownOption<T extends string> {
  value: T
  label: string
}

interface FilterDropdownProps<T extends string> {
  value: T | null
  onChange: (v: T | null) => void
  options: ReadonlyArray<FilterDropdownOption<T>>
  /** Label shown when nothing is selected. Defaults to "All". */
  placeholder?: string
  className?: string
}

/**
 * Compact, single-select dropdown sized to match the Pills track in the
 * Stats/Reports filter bar. Used for filters with too many options to
 * fit as Pills (Hold, Emotion, Model).
 *
 * `null` is the "All" sentinel — picking the placeholder row clears the
 * filter. Closes on outside click.
 */
export function FilterDropdown<T extends string>({
  value,
  onChange,
  options,
  placeholder = 'All',
  className,
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = options.find(o => o.value === value)
  const display = selected ? selected.label : placeholder

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        // Trigger styling matches the trade-page Select: same recessed bg,
        // same height, same padding, same chevron — so the filter bar reads
        // as the same form-control vocabulary as the trade form.
        className="w-full min-w-[6rem] h-8 flex items-center justify-between gap-2 pl-2.5 pr-2 text-sm rounded-(--radius) bg-(--color-bg) text-(--color-text) cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-(--color-accent-soft)"
      >
        <span
          className={cn(
            'truncate',
            value === null && 'text-(--color-text-dim)',
          )}
        >
          {display}
        </span>
        <ChevronDown className="size-4 shrink-0 text-(--color-text-dim)" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-full bg-(--color-panel) border border-(--color-border-strong) rounded-(--radius) shadow-(--shadow-md) overflow-hidden">
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={cn(
              'block w-full text-left px-2.5 py-1.5 text-sm whitespace-nowrap cursor-pointer transition-colors',
              value === null
                ? 'bg-(--color-panel-2) text-(--color-text)'
                : 'text-(--color-text-dim) hover:bg-(--color-panel-2) hover:text-(--color-text)',
            )}
          >
            {placeholder}
          </button>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className={cn(
                'block w-full text-left px-2.5 py-1.5 text-sm whitespace-nowrap cursor-pointer transition-colors',
                opt.value === value
                  ? 'bg-(--color-panel-2) text-(--color-text)'
                  : 'text-(--color-text-dim) hover:bg-(--color-panel-2) hover:text-(--color-text)',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
