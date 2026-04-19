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
    <label className={cn('flex flex-col gap-1', className)}>
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
