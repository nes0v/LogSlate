import { StarRating } from '@/components/form/StarRating'
import type { Rating } from '@/db/types'
import { RATING_TO_STARS, STARS_TO_RATING } from '@/lib/rating'
import { cn } from '@/lib/utils'

interface RatingFilterProps {
  value: Rating | null
  onChange: (v: Rating | null) => void
  className?: string
}

export function RatingFilter({ value, onChange, className }: RatingFilterProps) {
  const isAll = value === null
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-(--radius) bg-(--color-bg) p-0.5',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'inline-flex items-center rounded-[6px] px-2.5 py-1 text-sm cursor-pointer transition-colors whitespace-nowrap',
          isAll
            ? 'bg-(--color-panel) text-(--color-text) shadow-(--shadow-drop-xs)'
            : 'text-(--color-text-dim) hover:text-(--color-text)',
        )}
      >
        All
      </button>
      <StarRating
        value={value ? RATING_TO_STARS[value] : 0}
        onChange={n => onChange(n === 0 ? null : STARS_TO_RATING[n - 1])}
        count={3}
        allowClear
        emptyColor="var(--color-panel)"
        className="px-1.5"
      />
    </div>
  )
}
