import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FieldProps {
  label: string
  error?: string
  children: ReactNode
  className?: string
}

export function Field({ label, error, children, className }: FieldProps) {
  // `<div>` (not `<label>`) on purpose: when a label wraps multiple form
  // controls (e.g. a group of pill-buttons), browsers forward `:hover`
  // and click events to the *first* labeled control, which causes the
  // first pill to spuriously appear hovered when any sibling is hovered.
  // The group role + aria-labelledby gives the controls inside the label's
  // name instead.
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className={cn('flex flex-col gap-2', className)}>
      <span id={labelId} className="text-xs text-(--color-text-dim)">{label}</span>
      {children}
      {error && <span className="text-xs text-(--color-loss)">{error}</span>}
    </div>
  )
}

// Inputs share a single look across the app, matching the Pills track:
// - recessed `bg` color (the page bg) so they look inset on a panel parent
// - no border anywhere (consistent with the borderless section design)
// - placeholder uses `text-faint` (the lightest tier) so it doesn't compete
//   with real text once the user starts typing
// - focus shows a 2px accent-soft ring as the only "active" affordance
export const inputClass =
  'bg-(--color-bg) rounded-(--radius) px-2.5 py-1.5 text-sm font-sans ' +
  'text-(--color-text) placeholder:text-(--color-text-faint) ' +
  'focus:outline-none focus:ring-2 focus:ring-(--color-accent-soft)'

// Compact variant for dense settings panels (less padding, same look).
// Includes `w-full` since it's designed to fill grid cells.
export const inputClassCompact =
  'w-full rounded-(--radius) bg-(--color-bg) px-2 py-1.5 text-sm ' +
  'text-(--color-text) placeholder:text-(--color-text-faint) ' +
  'outline-none focus:ring-2 focus:ring-(--color-accent-soft)'
