import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { WEEK_OPTS } from '@/lib/buckets'

// 6×7 day grid for `month` aligned to the week start, including leading/
// trailing days from neighboring months. Used by the calendar route and
// the date-picker popover.
export function monthDayGrid(month: Date): {
  start: Date
  end: Date
  days: Date[]
} {
  const start = startOfWeek(startOfMonth(month), WEEK_OPTS)
  const end = endOfWeek(endOfMonth(month), WEEK_OPTS)
  return { start, end, days: eachDayOfInterval({ start, end }) }
}
