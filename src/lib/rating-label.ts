import type { Rating } from '@/db/types'

// Display glyph for each rating. The DB still stores the historical
// 'good' / 'excellent' / 'egg' values; this map is just for the UI.
export const RATING_LABEL: Record<Rating, string> = {
  excellent: '🔥',
  good: '👍',
  egg: '👎',
}

// Per-rating CSS effect. Color emoji glyphs ignore `text-color`, so we
// desaturate the thumbs-down with `grayscale` + `opacity` instead — that
// way 👎 reads as a dim/greyish "no" while 🔥 and 👍 stay full colour.
export const RATING_TEXT_CLASS: Record<Rating, string> = {
  excellent: '',
  good: '',
  egg: 'grayscale opacity-60',
}
