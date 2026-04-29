import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: ReactNode
}

interface SelectProps {
  /** `null` represents "nothing selected" — the trigger renders blank. */
  value: string | null
  onChange: (v: string | null) => void
  options: SelectOption[]
  className?: string
  ariaLabel?: string
}

// Form-friendly nullable dropdown. Trigger matches `inputClass` (recessed
// bg, same height as other form inputs); open menu uses panel bg with a
// `border-strong` ring so it stays visible against the surrounding panel.
// Picking the active row clears the selection.
export function Select({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: SelectProps) {
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

  const selected = options.find(o => o.value === value) ?? null

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full h-8 flex items-center justify-between gap-2 pl-2.5 pr-2 text-sm rounded-(--radius)',
          'bg-(--color-bg) text-(--color-text) cursor-pointer transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-(--color-accent-soft)',
        )}
      >
        {/* Empty span collapses to 0 height when no value — the &nbsp;
            keeps the trigger the same height in both states. */}
        <span className="truncate">{selected?.label ?? ' '}</span>
        <ChevronDown className="size-4 shrink-0 text-(--color-text-dim)" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-(--color-panel) border border-(--color-border-strong) rounded-(--radius) shadow-(--shadow-md) overflow-hidden">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value === value ? null : opt.value)
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
