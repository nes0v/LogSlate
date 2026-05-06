import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  size?: 'sm' | 'md'
}

// Styled checkbox. The native input is visually hidden but kept for
// accessibility / form semantics; the visible square and check icon are
// siblings of the input so they can react to `peer-checked`.
export function Checkbox({ className, size = 'md', ...props }: Props) {
  const box =
    size === 'sm'
      ? 'size-3.5 rounded-[3px]'
      : 'size-4 rounded-[4px]'
  const wrap = size === 'sm' ? 'size-3.5' : 'size-4'
  const icon = size === 'sm' ? 'size-2.5' : 'size-3'
  return (
    <span className={cn('relative inline-flex items-center justify-center shrink-0', wrap, className)}>
      <input
        type="checkbox"
        className="peer absolute inset-0 size-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          box,
          'border bg-(--color-bg) border-(--color-border-strong) transition-colors',
          'peer-hover:border-(--color-text)',
          'peer-checked:bg-(--color-accent) peer-checked:border-(--color-accent)',
          // Higher-specificity override so a checked-AND-hovered box
          // stays accent-bordered instead of switching to text-bright.
          'peer-checked:peer-hover:border-(--color-accent)',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-(--color-accent-soft)',
          'peer-disabled:opacity-40',
        )}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className={cn(
          'absolute pointer-events-none text-(--color-accent-fg)',
          icon,
          'opacity-0 transition-opacity peer-checked:opacity-100',
        )}
      />
    </span>
  )
}
