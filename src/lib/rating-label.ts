import type { Rating } from '@/db/types'

// Short letter-grade label for each rating value. The DB still stores the
// historical 'good' / 'excellent' / 'egg' values; this map is just for
// display. A is the highest grade, C the lowest.
export const RATING_LABEL: Record<Rating, string> = {
  excellent: 'A',
  good: 'B',
  egg: 'C',
}
