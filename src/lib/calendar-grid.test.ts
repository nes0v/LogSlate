import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'
import { monthDayGrid } from './calendar-grid'

describe('monthDayGrid', () => {
  it('returns a 6-week, Sunday-aligned grid', () => {
    // April 2026: 1st is Wednesday; expected leading Sun-Tue from March.
    const { start, end, days } = monthDayGrid(new Date(2026, 3, 1))
    expect(days.length % 7).toBe(0)
    expect(days.length).toBeGreaterThanOrEqual(28)
    expect(start.getDay()).toBe(0)
    expect(end.getDay()).toBe(6)
    expect(format(days[0], 'yyyy-MM-dd')).toBe(format(start, 'yyyy-MM-dd'))
    expect(format(days[days.length - 1], 'yyyy-MM-dd')).toBe(
      format(end, 'yyyy-MM-dd'),
    )
  })

  it('includes leading days from the previous month when month does not start on Sunday', () => {
    // March 2026: 1st is Sunday → grid starts exactly on March 1.
    const { days: marchDays } = monthDayGrid(new Date(2026, 2, 1))
    expect(format(marchDays[0], 'yyyy-MM-dd')).toBe('2026-03-01')

    // May 2026: 1st is Friday → grid starts the prior Sunday (April 26).
    const { days: mayDays } = monthDayGrid(new Date(2026, 4, 1))
    expect(format(mayDays[0], 'yyyy-MM-dd')).toBe('2026-04-26')
  })
})
