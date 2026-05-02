import { Star } from 'lucide-react'
import type { Rating } from '@/db/types'
import { RATING_TO_STARS } from '@/lib/rating'
import { cn } from '@/lib/utils'

interface RatingStarsProps {
  rating: Rating
  size?: number
  className?: string
}

export function RatingStars({ rating, size = 14, className }: RatingStarsProps) {
  const filled = RATING_TO_STARS[rating]
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {Array.from({ length: 3 }, (_, i) => {
        const on = i < filled
        return (
          <Star
            key={i}
            strokeWidth={0}
            style={{
              width: size,
              height: size,
              fill: on ? '#FFD700' : 'var(--color-bg)',
              color: on ? '#FFD700' : 'var(--color-bg)',
            }}
          />
        )
      })}
    </span>
  )
}
