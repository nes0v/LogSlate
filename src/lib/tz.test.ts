import { describe, expect, it } from 'vitest'
import { nyDateKey, nyMonthKey, nyTimeHHmm, nyToday } from './tz'

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
