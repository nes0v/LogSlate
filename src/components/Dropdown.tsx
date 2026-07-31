import { useRef, useState, type ReactNode } from 'react'
import { useOutsideClick } from '@/lib/use-outside-click'
import { cn } from '@/lib/utils'

export interface DropdownOption<T extends string> {
  value: T
  /** Rendered inside the menu item — typically icon + text. */
  label: ReactNode
}

interface DropdownProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: DropdownOption<T>[]
  /** Closed-state content — usually a compact icon or letter.
   *  Falls back to the active option's `label` when omitted. */
  trigger?: ReactNode
  className?: string
  /** Tooltip on the closed trigger button. */
  ariaLabel?: string
}

/**
 * Minimal click-to-open dropdown — no chevron, no portal, no animation.
 * Closes on outside click and after selection.
 */
export function Dropdown<T extends string>({
  value,
  onChange,
  options,
  trigger,
  className,
  ariaLabel,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useOutsideClick(ref, open, () => setOpen(false))

  const selectedLabel = trigger ?? options.find(o => o.value === value)?.label ?? null

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center justify-center px-2 py-1 text-xs font-mono rounded-(--radius) bg-(--color-panel) text-(--color-text) hover:bg-(--color-panel-2)"
      >
        {selectedLabel}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-max bg-(--color-panel) border border-(--color-border-strong) rounded-(--radius) overflow-hidden">
          {options.map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className={cn(
                'block w-full text-left px-3 py-1.5 text-sm whitespace-nowrap cursor-pointer',
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
