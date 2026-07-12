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

// Ratings ordered best→worst (3→1 stars) for at-a-glance breakdowns — the
// Ratings donut and the Compare "Rating" axis. Derived from
// `STARS_TO_RATING` so the set of ratings stays single-sourced.
export const RATING_DISPLAY_ORDER = [...STARS_TO_RATING].reverse() as readonly Rating[]

// Chart swatch per rating. Defined once, mirroring `SESSION_BG` /
// `EMOTION_COLORS` / `HOLD_PALETTE`, so every rating visual agrees.
export const RATING_COLORS: Record<Rating, string> = {
  excellent: 'var(--color-win)',
  good: 'var(--color-accent)',
  poor: 'var(--color-chart-muted)',
}
