import { describe, expect, it } from 'vitest'
import {
  bucketByDay,
  bucketByMonth,
  bucketByQuarter,
  bucketByTimeframe,
  bucketByWeek,
  bucketByYear,
  bucketKeyToTs,
  chartDayLabel,
  dateToBucketKey,
  parseYearMonth,
  WEEK_OPTS,
} from './buckets'
import { tradeRecord } from '@/test/fixtures'
import { nyDateKey } from '@/lib/tz'

describe('parseYearMonth', () => {
  it('parses valid yyyy-MM', () => {
    const d = parseYearMonth('2026-04')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3) // April = 3
    expect(d.getDate()).toBe(1)
  })

  it('falls back to current NY-calendar month for invalid input', () => {
    const d = parseYearMonth('not-a-date')
    const [yyyy, mm] = nyDateKey().split('-')
    expect(d.getFullYear()).toBe(Number(yyyy))
    expect(d.getMonth()).toBe(Number(mm) - 1)
  })

  it('falls back for undefined', () => {
    const d = parseYearMonth(undefined)
    expect(d.getDate()).toBe(1)
  })

  it('rejects out-of-range months instead of rolling them over', () => {
    // `2026-13` matches a bare \d{2} and date-fns would roll it to Jan 2027;
    // it must fall back to the current month, not silently advance a year.
    const [yyyy, mm] = nyDateKey().split('-')
    for (const bad of ['2026-13', '2026-00', '2026-99']) {
      const d = parseYearMonth(bad)
      expect(d.getFullYear()).toBe(Number(yyyy))
      expect(d.getMonth()).toBe(Number(mm) - 1)
    }
  })
})

describe('chartDayLabel', () => {
  it('returns MMM d for the 1st of the month', () => {
    expect(chartDayLabel('2026-04-01')).toBe('Apr 1')
    expect(chartDayLabel('2026-05-01')).toBe('May 1')
  })

  it('returns just the day number for other days', () => {
    expect(chartDayLabel('2026-04-02')).toBe('2')
    expect(chartDayLabel('2026-04-15')).toBe('15')
    expect(chartDayLabel('2026-04-30')).toBe('30')
  })
})

describe('bucketByDay', () => {
  it('generates one bucket per weekday in the range and skips weekends', () => {
    // Apr 1 2026 = Wed; Apr 7 = Tue. Range covers 5 weekdays + Sat/Sun.
    const start = new Date('2026-04-01T00:00:00')
    const end = new Date('2026-04-07T00:00:00')
    const buckets = bucketByDay([], start, end)
    expect(buckets).toHaveLength(5)
    expect(buckets.map(b => b.key)).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-06',
      '2026-04-07',
    ])
    expect(buckets[0].navTarget).toBe('/day/2026-04-01')
  })

  it('places trades into their weekday bucket by date', () => {
    const a = tradeRecord({ date: '2026-04-02' })
    const b = tradeRecord({ date: '2026-04-02' })
    const c = tradeRecord({ date: '2026-04-03' })
    const start = new Date('2026-04-01T00:00:00')
    const end = new Date('2026-04-07T00:00:00')
    const buckets = bucketByDay([a, b, c], start, end)
    // Buckets: Apr 1 Wed, Apr 2 Thu, Apr 3 Fri, Apr 6 Mon, Apr 7 Tue
    expect(buckets[1].trades).toHaveLength(2)
    expect(buckets[2].trades).toHaveLength(1)
    expect(buckets[3].trades).toHaveLength(0)
  })
})

describe('bucketByWeek', () => {
  it('buckets span Monday..Sunday with keys at the week start', () => {
    // April 2026: Wed 1st. First Monday in range = Mar 30 (spillover).
    const start = new Date('2026-04-01T00:00:00')
    const end = new Date('2026-04-20T00:00:00')
    const buckets = bucketByWeek([], start, end)
    expect(buckets.length).toBeGreaterThanOrEqual(3)
    // Each bucket's rangeStart should be a Monday (weekday 1)
    for (const b of buckets) {
      const d = new Date(b.rangeStart + 'T00:00:00')
      expect(d.getDay()).toBe(1)
    }
  })

  it('places trades into their week bucket', () => {
    const t = tradeRecord({ date: '2026-04-15' }) // Wednesday
    const start = new Date('2026-04-01T00:00:00')
    const end = new Date('2026-04-30T00:00:00')
    const buckets = bucketByWeek([t], start, end)
    const target = buckets.find(b => t.date >= b.rangeStart && t.date <= b.rangeEnd)
    expect(target).toBeDefined()
    expect(target!.trades).toContain(t)
  })
})

describe('WEEK_OPTS', () => {
  it('is Monday-based', () => {
    expect(WEEK_OPTS.weekStartsOn).toBe(1)
  })
})

describe('bucketByMonth', () => {
  it('emits one bucket per calendar month in the range with YYYY-MM keys', () => {
    // Range partially into Feb and Apr — still yields three full months.
    const start = new Date('2026-02-15T00:00:00')
    const end = new Date('2026-04-10T00:00:00')
    const buckets = bucketByMonth([], start, end)
    expect(buckets.map(b => b.key)).toEqual(['2026-02', '2026-03', '2026-04'])
    expect(buckets[0].rangeStart).toBe('2026-02-01')
    expect(buckets[0].rangeEnd).toBe('2026-02-28')
    expect(buckets[1].rangeEnd).toBe('2026-03-31')
    expect(buckets[2].rangeEnd).toBe('2026-04-30')
    expect(buckets[0].navTarget).toBe('/month/2026-02')
  })

  it('places trades into the bucket for their date month', () => {
    const a = tradeRecord({ date: '2026-03-15' })
    const b = tradeRecord({ date: '2026-03-31' })
    const c = tradeRecord({ date: '2026-04-01' })
    const start = new Date('2026-03-01T00:00:00')
    const end = new Date('2026-04-30T00:00:00')
    const buckets = bucketByMonth([a, b, c], start, end)
    expect(buckets[0].trades).toHaveLength(2)
    expect(buckets[1].trades).toHaveLength(1)
  })
})

describe('bucketByQuarter', () => {
  it('emits one bucket per calendar quarter with YYYY-Qn keys', () => {
    const start = new Date('2026-02-15T00:00:00')
    const end = new Date('2026-08-10T00:00:00')
    const buckets = bucketByQuarter([], start, end)
    expect(buckets.map(b => b.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3'])
    expect(buckets[0].rangeStart).toBe('2026-01-01')
    expect(buckets[0].rangeEnd).toBe('2026-03-31')
    expect(buckets[1].rangeStart).toBe('2026-04-01')
    expect(buckets[1].rangeEnd).toBe('2026-06-30')
    expect(buckets[0].navTarget).toBe('/month/2026-01')
  })

  it('places a trade into its quarter', () => {
    const t = tradeRecord({ date: '2026-05-10' }) // Q2
    const start = new Date('2026-01-01T00:00:00')
    const end = new Date('2026-12-31T00:00:00')
    const buckets = bucketByQuarter([t], start, end)
    expect(buckets[1].key).toBe('2026-Q2')
    expect(buckets[1].trades).toContain(t)
  })
})

describe('bucketByYear', () => {
  it('emits one bucket per year with YYYY keys', () => {
    const start = new Date('2025-03-01T00:00:00')
    const end = new Date('2027-06-01T00:00:00')
    const buckets = bucketByYear([], start, end)
    expect(buckets.map(b => b.key)).toEqual(['2025', '2026', '2027'])
    expect(buckets[1].rangeStart).toBe('2026-01-01')
    expect(buckets[1].rangeEnd).toBe('2026-12-31')
    expect(buckets[1].navTarget).toBe('/month/2026-01')
  })
})

describe('bucketByTimeframe', () => {
  const start = new Date('2026-04-01T00:00:00')
  const end = new Date('2026-04-07T00:00:00')

  it('dispatches to bucketByDay for D (weekdays only)', () => {
    const buckets = bucketByTimeframe('D', [], start, end)
    // Apr 1–7 2026 spans Wed..Tue → 5 weekdays after dropping Sat/Sun.
    expect(buckets).toHaveLength(5)
    expect(buckets[0].key).toBe('2026-04-01')
  })

  it('dispatches to bucketByWeek for W', () => {
    const buckets = bucketByTimeframe('W', [], start, end)
    // April 1–7 2026 (Wed..Tue) crosses a Monday boundary, so we get
    // the week of Mar 30 and the week of Apr 6 — both Monday-anchored.
    expect(buckets).toHaveLength(2)
    for (const b of buckets) {
      expect(new Date(b.rangeStart + 'T00:00:00').getDay()).toBe(1)
    }
  })

  it('dispatches to bucketByMonth for M', () => {
    const buckets = bucketByTimeframe('M', [], start, end)
    expect(buckets.map(b => b.key)).toEqual(['2026-04'])
  })

  it('dispatches to bucketByQuarter for Q', () => {
    const buckets = bucketByTimeframe('Q', [], start, end)
    expect(buckets.map(b => b.key)).toEqual(['2026-Q2'])
  })

  it('dispatches to bucketByYear for Y', () => {
    const buckets = bucketByTimeframe('Y', [], start, end)
    expect(buckets.map(b => b.key)).toEqual(['2026'])
  })
})

describe('dateToBucketKey', () => {
  it('D → the date itself', () => {
    expect(dateToBucketKey('2026-04-15', 'D')).toBe('2026-04-15')
  })

  it('W → the Monday of the containing week', () => {
    // 2026-04-15 (Wed) → 2026-04-13 (Mon)
    expect(dateToBucketKey('2026-04-15', 'W')).toBe('2026-04-13')
  })

  it('M → YYYY-MM', () => {
    expect(dateToBucketKey('2026-04-15', 'M')).toBe('2026-04')
  })

  it('Q → YYYY-Qn', () => {
    expect(dateToBucketKey('2026-01-01', 'Q')).toBe('2026-Q1')
    expect(dateToBucketKey('2026-04-15', 'Q')).toBe('2026-Q2')
    expect(dateToBucketKey('2026-07-01', 'Q')).toBe('2026-Q3')
    expect(dateToBucketKey('2026-12-31', 'Q')).toBe('2026-Q4')
  })

  it('Y → YYYY', () => {
    expect(dateToBucketKey('2026-04-15', 'Y')).toBe('2026')
  })

  it('is the inverse of bucketKeyToTs for W/M/Q/Y', () => {
    // Round-trip: date → key → ts (in UTC-seconds at bucket start).
    // This acts as a sanity check that the two sides agree on calendar
    // anchors (e.g. Q2 is April, Y is Jan 1 of that year).
    const cases: Array<[string, 'W' | 'M' | 'Q' | 'Y', number]> = [
      ['2026-04-15', 'W', Date.UTC(2026, 3, 13) / 1000], // Mon Apr 13
      ['2026-04-15', 'M', Date.UTC(2026, 3, 1) / 1000],
      ['2026-04-15', 'Q', Date.UTC(2026, 3, 1) / 1000],
      ['2026-04-15', 'Y', Date.UTC(2026, 0, 1) / 1000],
    ]
    for (const [date, tf, expected] of cases) {
      expect(bucketKeyToTs(dateToBucketKey(date, tf))).toBe(expected)
    }
  })
})

describe('bucketKeyToTs', () => {
  // Helper — re-derives Date.UTC for the test expectation so we don't
  // hardcode magic numbers that go stale with every TZ change.
  const utcSec = (y: number, m: number, d = 1) => Math.floor(Date.UTC(y, m, d) / 1000)

  it('parses YYYY-MM-DD (D/W key)', () => {
    expect(bucketKeyToTs('2026-04-15')).toBe(utcSec(2026, 3, 15))
  })

  it('parses YYYY-MM (M key)', () => {
    expect(bucketKeyToTs('2026-04')).toBe(utcSec(2026, 3, 1))
  })

  it('parses YYYY-Qn (Q key) — Q1..Q4 map to Jan/Apr/Jul/Oct', () => {
    expect(bucketKeyToTs('2026-Q1')).toBe(utcSec(2026, 0, 1))
    expect(bucketKeyToTs('2026-Q2')).toBe(utcSec(2026, 3, 1))
    expect(bucketKeyToTs('2026-Q3')).toBe(utcSec(2026, 6, 1))
    expect(bucketKeyToTs('2026-Q4')).toBe(utcSec(2026, 9, 1))
  })

  it('parses YYYY (Y key)', () => {
    expect(bucketKeyToTs('2026')).toBe(utcSec(2026, 0, 1))
  })

  it('returns 0 for unparseable input', () => {
    expect(bucketKeyToTs('garbage')).toBe(0)
    expect(bucketKeyToTs('')).toBe(0)
    // Malformed shapes (not one of the 4 accepted patterns) always 0.
    expect(bucketKeyToTs('2026/04')).toBe(0)
    expect(bucketKeyToTs('26-04')).toBe(0)
  })
})
