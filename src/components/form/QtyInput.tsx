import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QtyInputProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  className?: string
}

// Integer quantity input with stacked +/- buttons that fill the input's
// right edge (no gap top/bottom/right). Replaces the browser-default
// number spinner for a consistent look across platforms.
export function QtyInput({ value, onChange, min = 1, max, className }: QtyInputProps) {
  const inc = () => onChange(Math.min(max ?? Number.POSITIVE_INFINITY, value + 1))
  const dec = () => onChange(Math.max(min, value - 1))

  return (
    <div
      className={cn(
        'h-8 flex items-stretch bg-(--color-bg) rounded-(--radius) overflow-hidden',
        'focus-within:ring-2 focus-within:ring-(--color-accent-soft) transition-colors',
        className,
      )}
    >
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => {
          const n = Number(e.target.value.replace(/\D/g, ''))
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max ?? n, n)))
        }}
        onFocus={e => e.currentTarget.select()}
        className="flex-1 min-w-0 bg-transparent px-3 text-sm text-(--color-text) outline-none"
      />
      <div className="flex flex-col w-6 border-l border-(--color-panel)">
        <button
          type="button"
          tabIndex={-1}
          onClick={inc}
          aria-label="Increment"
          className="flex-1 flex items-center justify-center text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) transition-colors"
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={dec}
          aria-label="Decrement"
          className="flex-1 flex items-center justify-center text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) transition-colors"
        >
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  )
}
