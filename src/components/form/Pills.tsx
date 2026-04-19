import { cn } from '@/lib/utils'

interface PillsProps<T extends string | number> {
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
  className?: string
}

export function Pills<T extends string | number>({ value, onChange, options, className }: PillsProps<T>) {
  return (
    <div className={cn('inline-flex rounded-md border border-(--color-border) bg-(--color-panel) p-0.5', className)}>
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1 text-sm rounded-sm transition-colors',
              active
                ? 'bg-(--color-panel-2) text-(--color-text)'
                : 'text-(--color-text-dim) hover:text-(--color-text)',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
