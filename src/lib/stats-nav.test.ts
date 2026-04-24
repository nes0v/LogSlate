import { describe, expect, it } from 'vitest'
import { bucketNavTarget, drillDownRange, timeframeFromParams } from './stats-nav'

describe('timeframeFromParams', () => {
  it('returns D when tf is missing', () => {
    expect(timeframeFromParams(new URLSearchParams())).toBe('D')
  })

  it('returns the tf when valid', () => {
    expect(timeframeFromParams(new URLSearchParams('tf=D'))).toBe('D')
    expect(timeframeFromParams(new URLSearchParams('tf=W'))).toBe('W')
    expect(timeframeFromParams(new URLSearchParams('tf=M'))).toBe('M')
    expect(timeframeFromParams(new URLSearchParams('tf=Q'))).toBe('Q')
    expect(timeframeFromParams(new URLSearchParams('tf=Y'))).toBe('Y')
  })

  it('falls back to D for invalid tf values', () => {
    expect(timeframeFromParams(new URLSearchParams('tf=X'))).toBe('D')
    expect(timeframeFromParams(new URLSearchParams('tf='))).toBe('D')
    expect(timeframeFromParams(new URLSearchParams('tf=d'))).toBe('D') // case-sensitive
  })
})

describe('bucketNavTarget', () => {
  it('D → /day/:date', () => {
    expect(bucketNavTarget('2026-03-15', 'D')).toBe('/day/2026-03-15')
  })

  it('W → /month of the week-start date', () => {
    expect(bucketNavTarget('2026-03-29', 'W')).toBe('/month/2026-03')
    // Cross-month week: Sunday Mar 29, Saturday Apr 4 — uses the
    // week's start month.
    expect(bucketNavTarget('2026-08-31', 'W')).toBe('/month/2026-08')
  })

  it('M → /month/:ym unchanged', () => {
    expect(bucketNavTarget('2026-03', 'M')).toBe('/month/2026-03')
  })

  it('Q → /month of the first month in the quarter', () => {
    expect(bucketNavTarget('2026-Q1', 'Q')).toBe('/month/2026-01')
    expect(bucketNavTarget('2026-Q2', 'Q')).toBe('/month/2026-04')
    expect(bucketNavTarget('2026-Q3', 'Q')).toBe('/month/2026-07')
    expect(bucketNavTarget('2026-Q4', 'Q')).toBe('/month/2026-10')
  })

  it('Q with malformed key falls back to /', () => {
    expect(bucketNavTarget('garbage', 'Q')).toBe('/')
    expect(bucketNavTarget('2026-Q5', 'Q')).toBe('/')
  })

  it('Y → /month/:year-01 (January of that year)', () => {
    expect(bucketNavTarget('2026', 'Y')).toBe('/month/2026-01')
  })
})

describe('drillDownRange', () => {
  it('D returns null — use bucketNavTarget for day navigation', () => {
    expect(drillDownRange('D', '2026-03-15')).toBeNull()
  })

  it('W spans Sunday..Saturday and switches to D', () => {
    // Mar 29 2026 is a Sunday
    expect(drillDownRange('W', '2026-03-29')).toEqual({
      from: '2026-03-29',
      to: '2026-04-04',
      tf: 'D',
    })
  })

  it('M spans the full calendar month and switches to D', () => {
    expect(drillDownRange('M', '2026-03')).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
      tf: 'D',
    })
    // Feb non-leap year = 28 days
    expect(drillDownRange('M', '2026-02')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      tf: 'D',
    })
    // Feb leap year = 29 days
    expect(drillDownRange('M', '2024-02')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
      tf: 'D',
    })
  })

  it('Q spans exactly three calendar months and switches to D', () => {
    expect(drillDownRange('Q', '2026-Q1')).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      tf: 'D',
    })
    expect(drillDownRange('Q', '2026-Q2')).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
      tf: 'D',
    })
    expect(drillDownRange('Q', '2026-Q3')).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
      tf: 'D',
    })
    expect(drillDownRange('Q', '2026-Q4')).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
      tf: 'D',
    })
  })

  it('Q with unparseable key returns null', () => {
    expect(drillDownRange('Q', 'garbage')).toBeNull()
    expect(drillDownRange('Q', '2026-Q5')).toBeNull()
    expect(drillDownRange('Q', '2026')).toBeNull()
  })

  it('Y spans the full calendar year and switches to W', () => {
    expect(drillDownRange('Y', '2026')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      tf: 'W',
    })
  })

  it('Y with malformed key returns null', () => {
    expect(drillDownRange('Y', 'garbage')).toBeNull()
    expect(drillDownRange('Y', '26')).toBeNull()
  })

  it('M with malformed key returns null', () => {
    expect(drillDownRange('M', 'garbage')).toBeNull()
    expect(drillDownRange('M', '2026')).toBeNull()
  })

  it('W with malformed key returns null', () => {
    expect(drillDownRange('W', 'garbage')).toBeNull()
    expect(drillDownRange('W', '2026-03')).toBeNull()
  })
})
