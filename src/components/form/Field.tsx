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
  return (
    <label className={cn('flex flex-col gap-2', className)}>
      <span className="text-xs text-(--color-text-dim)">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-(--color-text-dim)">{hint}</span>}
      {error && <span className="text-xs text-(--color-loss)">{error}</span>}
    </label>
  )
}

export const inputClass =
  'bg-(--color-panel) border border-(--color-border) rounded-md px-3 py-1.5 text-sm ' +
  'text-(--color-text) placeholder:text-(--color-text-dim) ' +
  'focus:outline-none focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)'

// Compact variant for dense settings panels (less padding, no focus ring).
// Includes `w-full` since it's designed to fill grid cells.
export const inputClassCompact =
  'w-full rounded-md border border-(--color-border) bg-(--color-panel) px-2 py-1.5 text-sm outline-none focus:border-(--color-accent)'
