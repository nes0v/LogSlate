import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

// 6×7 day grid for `month` aligned to a Sunday start, including leading/
// trailing days from neighboring months. Used by the calendar route and
// the date-picker popover.
//
// Deliberately hardcoded to Sunday-first regardless of the app-wide
// `WEEK_OPTS` (which is Monday for chart-/bucket-purposes) — the
// calendar UI keeps the Sun…Sat column order the user is used to.
const CAL_GRID_OPTS = { weekStartsOn: 0 as const }

export function monthDayGrid(month: Date): {
  start: Date
  end: Date
  days: Date[]
} {
  const start = startOfWeek(startOfMonth(month), CAL_GRID_OPTS)
  const end = endOfWeek(endOfMonth(month), CAL_GRID_OPTS)
  return { start, end, days: eachDayOfInterval({ start, end }) }
}
