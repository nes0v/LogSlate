import type { Rating } from '@/db/types'

// Number of filled stars per rating. Single source of truth used by
// `RatingStars` (display), `RatingFilter` (segmented control), and the
// star picker on `TradeForm`.
export const RATING_TO_STARS: Record<Rating, number> = {
  poor: 1,
  good: 2,
  excellent: 3,
}

// Inverse: index 0..2 → rating. Drives the click handler on the star picker.
export const STARS_TO_RATING = ['poor', 'good', 'excellent'] as const
