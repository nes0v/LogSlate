import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StarRatingProps {
  value: number
  onChange: (v: number) => void
  count?: number
  size?: number
  className?: string
  /** When true, clicking the currently-selected star clears the value back to 0. */
  allowClear?: boolean
  /** Color for empty stars. Defaults to the page bg so empty stars vanish into the input track. */
  emptyColor?: string
}

export function StarRating({
  value,
  onChange,
  count = 3,
  size = 20,
  className,
  allowClear = false,
  emptyColor = 'var(--color-bg)',
}: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null)
  const active = hover ?? value
  return (
    <div
      className={cn('inline-flex items-center gap-1', className)}
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: count }, (_, i) => {
        const n = i + 1
        const filled = n <= active
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(allowClear && n === value ? 0 : n)}
            onMouseEnter={() => setHover(n)}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className="cursor-pointer p-0.5 text-(--color-text-faint) hover:text-(--color-accent)"
          >
            <Star
              strokeWidth={0}
              style={{
                width: size,
                height: size,
                fill: filled ? '#FFD700' : emptyColor,
                color: filled ? '#FFD700' : emptyColor,
              }}
            />
          </button>
        )
      })}
    </div>
  )
}
