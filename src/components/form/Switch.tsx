import { cn } from '@/lib/utils'

interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  ariaLabel?: string
  className?: string
}

// Pill-style on/off switch. Label sits left, the track/knob right; the
// whole row is the click target.
export function Switch({ checked, onChange, label, ariaLabel, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      onClick={() => onChange(!checked)}
      className={cn(
        'group flex items-center gap-2 text-sm text-(--color-text-dim) hover:text-(--color-text) transition-colors',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-(--color-accent)' : 'bg-(--color-border-strong)',
        )}
      >
        <span
          className={cn(
            'inline-block size-3 rounded-full bg-(--color-accent-fg) shadow-(--shadow-xs) transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
      <span>{label}</span>
    </button>
  )
}
