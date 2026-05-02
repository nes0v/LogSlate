import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Canonical "select one of N" control. Used everywhere a user picks from a
// short, mutually-exclusive set: form fields (Symbol/Contract/Session/...)
// AND settings pickers (theme, color scheme). Visual: an iOS-style segmented
// control — recessed track on the parent card, active item lifts out on
// `panel` with a subtle shadow.
//
// `prefix` is rendered before the label inside each pill (typically an
// icon swatch). Pass it on the option, not as JSX label, so the layout
// stays consistent across pills.

interface PillOption<T> {
  value: T
  label: ReactNode
  /** Rendered to the left of the label. Useful for icons or color swatches. */
  prefix?: ReactNode
}

interface PillsProps<T extends string | number | null> {
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<PillOption<T>>
  className?: string
  /** Tighter padding for use inside form rows. */
  size?: 'md' | 'sm'
}

export function Pills<T extends string | number | null>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: PillsProps<T>) {
  return (
    <div
      className={cn(
        // Track = `bg` (recessed inside its parent card); active item lifts
        // out on `panel` with a small shadow. iOS-style segmented control.
        'inline-flex rounded-(--radius) bg-(--color-bg) p-0.5',
        className,
      )}
    >
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[6px] cursor-pointer transition-colors whitespace-nowrap',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-2.5 py-1 text-sm',
              active
                ? 'bg-(--color-panel) text-(--color-text) shadow-(--shadow-xs)'
                : 'text-(--color-text-dim) hover:text-(--color-text)',
            )}
          >
            {opt.prefix}
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
