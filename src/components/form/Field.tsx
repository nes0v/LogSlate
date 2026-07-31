import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FieldProps {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  // `<div>` (not `<label>`) on purpose: when a label wraps multiple form
  // controls (e.g. a group of pill-buttons), browsers forward `:hover`
  // and click events to the *first* labeled control, which causes the
  // first pill to spuriously appear hovered when any sibling is hovered.
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-xs text-(--color-text-dim)">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-(--color-text-dim)">{hint}</span>}
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
