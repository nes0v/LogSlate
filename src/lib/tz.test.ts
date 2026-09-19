import { describe, expect, it } from 'vitest'
import {
  nextWeekdayKey,
  nyDateKey,
  nyMonthKey,
  nyTimeHHmm,
  nyToday,
  previousWeekdayKey,
  isoWeekEndKey,
  weekEndKey,
  weekStartKey,
} from './tz'

describe('nyDateKey', () => {
  it('returns YYYY-MM-DD in NY timezone', () => {
    // 2026-04-21 00:00 UTC is 2026-04-20 20:00 NY (ET UTC-4 in April)
    const d = new Date('2026-04-21T00:00:00Z')
    expect(nyDateKey(d)).toBe('2026-04-20')
  })

  it('handles DST (winter)', () => {
    // Dec 15, 23:00 UTC = Dec 15, 18:00 NY (EST UTC-5)
    const d = new Date('2026-12-15T23:00:00Z')
    expect(nyDateKey(d)).toBe('2026-12-15')
  })

  it('handles year boundary — UTC has rolled over but NY has not', () => {
    // 2026-01-01 03:00 UTC = 2025-12-31 22:00 NY (EST)
    const d = new Date('2026-01-01T03:00:00Z')
    expect(nyDateKey(d)).toBe('2025-12-31')
  })
})

describe('nyMonthKey', () => {
  it('returns YYYY-MM in NY timezone', () => {
    const d = new Date('2026-04-21T13:00:00Z')
    expect(nyMonthKey(d)).toBe('2026-04')
  })

  it('returns the prior month near year/month boundary', () => {
    // 2026-01-01 03:00 UTC is still December 31 in NY.
    const d = new Date('2026-01-01T03:00:00Z')
    expect(nyMonthKey(d)).toBe('2025-12')
  })
})

describe('nyToday', () => {
  it('matches nyDateKey() for the current instant', () => {
    expect(nyToday()).toBe(nyDateKey())
  })
})

describe('nyTimeHHmm', () => {
  it('formats NY clock time (EDT)', () => {
    const d = new Date('2026-04-21T13:30:00Z') // 09:30 NY
    expect(nyTimeHHmm(d)).toBe('09:30')
  })

  it('formats NY clock time (EST)', () => {
    const d = new Date('2026-12-15T14:30:00Z') // 09:30 NY
    expect(nyTimeHHmm(d)).toBe('09:30')
  })
})

describe('isoWeekEndKey', () => {
  it('closes the week on Sunday', () => {
    // Mon 2026-05-11 through Sun 2026-05-17 all close on the 17th.
    expect(isoWeekEndKey('2026-05-11')).toBe('2026-05-17')
    expect(isoWeekEndKey('2026-05-16')).toBe('2026-05-17')
    expect(isoWeekEndKey('2026-05-17')).toBe('2026-05-17')
  })

  it('sits one day past the feed week, except on Sunday', () => {
    // Sat: feed week ends that day, the Mon-Sun week runs one more.
    expect(weekEndKey(weekStartKey('2026-05-16'))).toBe('2026-05-16')
    expect(isoWeekEndKey('2026-05-16')).toBe('2026-05-17')
    // Sun: the feed week is only just opening, so it reaches far further.
    expect(weekEndKey(weekStartKey('2026-05-17'))).toBe('2026-05-23')
    expect(isoWeekEndKey('2026-05-17')).toBe('2026-05-17')
  })
})

describe('weekStartKey / weekEndKey', () => {
  it('anchors a week on Sunday and closes it on Saturday', () => {
    // 2026-05-12 is a Tuesday; its feed week runs Sun 10th - Sat 16th.
    expect(weekStartKey('2026-05-12')).toBe('2026-05-10')
    expect(weekEndKey('2026-05-10')).toBe('2026-05-16')
  })

  it('leaves a Sunday where it is and rolls a Saturday back', () => {
    expect(weekStartKey('2026-05-10')).toBe('2026-05-10')
    expect(weekStartKey('2026-05-16')).toBe('2026-05-10')
  })

  it('crosses a month boundary', () => {
    // Tue 2026-06-02 belongs to the week that opened Sun 2026-05-31.
    expect(weekStartKey('2026-06-02')).toBe('2026-05-31')
    expect(weekEndKey('2026-05-31')).toBe('2026-06-06')
  })
})

describe('previousWeekdayKey', () => {
  it('returns a weekday unchanged', () => {
    expect(previousWeekdayKey('2026-06-17')).toBe('2026-06-17') // Wed
  })
  it('rolls Saturday back to Friday', () => {
    expect(previousWeekdayKey('2026-06-20')).toBe('2026-06-19')
  })
  it('rolls Sunday back to Friday', () => {
    expect(previousWeekdayKey('2026-06-21')).toBe('2026-06-19')
  })
  it('crosses the month boundary', () => {
    expect(previousWeekdayKey('2026-08-01')).toBe('2026-07-31') // Sat → Fri
  })
})

describe('nextWeekdayKey', () => {
  it('returns a weekday unchanged', () => {
    expect(nextWeekdayKey('2026-06-17')).toBe('2026-06-17') // Wed
  })
  it('rolls Saturday forward to Monday', () => {
    expect(nextWeekdayKey('2026-06-20')).toBe('2026-06-22')
  })
  it('rolls Sunday forward to Monday', () => {
    expect(nextWeekdayKey('2026-06-21')).toBe('2026-06-22')
  })
  it('crosses the month boundary', () => {
    expect(nextWeekdayKey('2026-02-28')).toBe('2026-03-02') // Sat → Mon
  })
})

describe('week helpers across awkward boundaries', () => {
  it('crosses a year boundary', () => {
    // Thu 2026-12-31 sits in the feed week opening Sun 2026-12-27.
    expect(weekStartKey('2026-12-31')).toBe('2026-12-27')
    expect(weekEndKey('2026-12-27')).toBe('2027-01-02')
    expect(isoWeekEndKey('2026-12-31')).toBe('2027-01-03')
    // And the first days of the new year look back into the old one.
    expect(weekStartKey('2027-01-01')).toBe('2026-12-27')
  })

  it('crosses the spring-forward DST change', () => {
    // US DST begins Sun 2026-03-08. Date arithmetic here is calendar-day
    // arithmetic, so the short day must not shift a week boundary.
    expect(weekStartKey('2026-03-08')).toBe('2026-03-08')
    expect(weekStartKey('2026-03-11')).toBe('2026-03-08')
    expect(weekEndKey('2026-03-08')).toBe('2026-03-14')
    expect(isoWeekEndKey('2026-03-09')).toBe('2026-03-15')
  })

  it('crosses the fall-back DST change', () => {
    // US DST ends Sun 2026-11-01 — the 25-hour day.
    expect(weekStartKey('2026-11-01')).toBe('2026-11-01')
    expect(weekStartKey('2026-11-04')).toBe('2026-11-01')
    expect(weekEndKey('2026-11-01')).toBe('2026-11-07')
    expect(isoWeekEndKey('2026-10-30')).toBe('2026-11-01')
  })

  it('handles a leap day', () => {
    expect(weekStartKey('2028-02-29')).toBe('2028-02-27')
    expect(weekEndKey('2028-02-27')).toBe('2028-03-04')
  })
})
