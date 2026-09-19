import { describe, expect, it } from 'vitest'
import { isWeekend } from 'date-fns'
import { dateKeyToDate } from '@/lib/tz'
import type { ProgressRule } from '@/db/types'
import {
  closePeriod,
  lastPeriodEnd,
  openPeriod,
  openPeriodStart,
  ruleActiveOn,
  ruleHasOpenPeriod,
} from './progress-periods'

function rule(overrides: Partial<ProgressRule> = {}): ProgressRule {
  return {
    id: 'r1',
    account_id: 'main',
    text: 'Test rule',
    periods: [],
    sort: 0,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('ruleActiveOn', () => {
  it('returns true when the date sits inside an open period', () => {
    const r = rule({ periods: [{ from: '2026-05-11', until: null }] })
    expect(ruleActiveOn(r, '2026-05-11')).toBe(true)
    expect(ruleActiveOn(r, '2026-05-17')).toBe(true)
    expect(ruleActiveOn(r, '2026-12-31')).toBe(true)
  })

  it('returns false when the date is before any period', () => {
    const r = rule({ periods: [{ from: '2026-05-11', until: null }] })
    expect(ruleActiveOn(r, '2026-05-10')).toBe(false)
  })

  it('returns true for the upper bound when until is set (inclusive)', () => {
    const r = rule({ periods: [{ from: '2026-05-11', until: '2026-05-16' }] })
    expect(ruleActiveOn(r, '2026-05-16')).toBe(true)
    expect(ruleActiveOn(r, '2026-05-17')).toBe(false)
  })

  it('handles multiple periods (gap in middle)', () => {
    const r = rule({
      periods: [
        { from: '2026-05-01', until: '2026-05-10' },
        { from: '2026-05-15', until: null },
      ],
    })
    expect(ruleActiveOn(r, '2026-05-05')).toBe(true)
    expect(ruleActiveOn(r, '2026-05-12')).toBe(false)
    expect(ruleActiveOn(r, '2026-05-15')).toBe(true)
    expect(ruleActiveOn(r, '2026-12-01')).toBe(true)
  })

})

describe('ruleHasOpenPeriod', () => {
  it('true iff at least one period has until=null', () => {
    expect(ruleHasOpenPeriod(rule({ periods: [{ from: '2026-05-11', until: null }] }))).toBe(true)
    expect(ruleHasOpenPeriod(rule({ periods: [{ from: '2026-05-11', until: '2026-05-16' }] }))).toBe(false)
    expect(ruleHasOpenPeriod(rule({ periods: [] }))).toBe(false)
  })
})

describe('openPeriodStart', () => {
  it('returns the open period start, ignoring closed ones', () => {
    const r = rule({
      periods: [
        { from: '2026-05-01', until: '2026-05-08' },
        { from: '2026-05-18', until: null },
      ],
    })
    expect(openPeriodStart(r)).toBe('2026-05-18')
  })

  it('returns null for a retired rule', () => {
    expect(
      openPeriodStart(rule({ periods: [{ from: '2026-05-01', until: '2026-05-08' }] })),
    ).toBeNull()
    expect(openPeriodStart(rule({ periods: [] }))).toBeNull()
  })

  it('distinguishes a scheduled rule from a live one', () => {
    // Both are switched on; only the second has taken effect by Friday.
    const scheduled = rule({ periods: [{ from: '2026-05-18', until: null }] })
    const live = rule({ periods: [{ from: '2026-05-11', until: null }] })
    const friday = '2026-05-15'
    expect(openPeriodStart(scheduled)! > friday).toBe(true)
    expect(openPeriodStart(live)! > friday).toBe(false)
    // ...which is exactly the gap ruleHasOpenPeriod cannot see.
    expect(ruleHasOpenPeriod(scheduled)).toBe(ruleHasOpenPeriod(live))
  })
})

describe('lastPeriodEnd', () => {
  it('returns the latest closed end, ignoring the open one', () => {
    const r = rule({
      periods: [
        { from: '2026-05-01', until: '2026-05-08' },
        { from: '2026-05-11', until: '2026-05-15' },
        { from: '2026-05-18', until: null },
      ],
    })
    expect(lastPeriodEnd(r)).toBe('2026-05-15')
  })

  it('returns null when nothing is closed', () => {
    expect(lastPeriodEnd(rule({ periods: [{ from: '2026-05-11', until: null }] }))).toBeNull()
    expect(lastPeriodEnd(rule({ periods: [] }))).toBeNull()
  })

  it('spots a rule retired ahead of time — off, but today still counts it', () => {
    // Unticked on Tuesday's page while today is Monday: closes at Monday.
    const r = rule({ periods: [{ from: '2026-05-04', until: '2026-05-18' }] })
    const monday = '2026-05-18'
    expect(ruleHasOpenPeriod(r)).toBe(false)       // right panel: unticked
    expect(ruleActiveOn(r, monday)).toBe(true)     // left panel: still listed
    expect(lastPeriodEnd(r)).toBe(monday)          // ...so the row can say "until Mon"
  })
})

describe('openPeriod', () => {
  // 2026-05-20 is a Wednesday — the ordinary weekday path, where the next
  // trading day is today itself.
  it('appends a new open period when none is open', () => {
    const r = rule({ periods: [{ from: '2026-05-01', until: '2026-05-08' }] })
    expect(openPeriod(r, '2026-05-20')).toEqual([
      { from: '2026-05-01', until: '2026-05-08' },
      { from: '2026-05-20', until: null },
    ])
  })

  it('returns the existing periods unchanged when one is already open', () => {
    const periods = [{ from: '2026-05-11', until: null }]
    const r = rule({ periods })
    expect(openPeriod(r, '2026-05-20')).toEqual(periods)
  })

  it('starts a first period for a brand-new rule', () => {
    expect(openPeriod(rule({ periods: [] }), '2026-05-20')).toEqual([
      { from: '2026-05-20', until: null },
    ])
  })
})

describe('closePeriod', () => {
  it('closes an open period at the previous trading day', () => {
    const r = rule({ periods: [{ from: '2026-05-11', until: null }] })
    expect(closePeriod(r, '2026-05-20')).toEqual([
      { from: '2026-05-11', until: '2026-05-19' },
    ])
  })

  it('drops a period that was opened earlier today (no effective days)', () => {
    const r = rule({ periods: [{ from: '2026-05-20', until: null }] })
    expect(closePeriod(r, '2026-05-20')).toEqual([])
  })

  it('leaves closed periods untouched while closing the open one', () => {
    const r = rule({
      periods: [
        { from: '2026-05-01', until: '2026-05-05' },
        { from: '2026-05-11', until: null },
      ],
    })
    expect(closePeriod(r, '2026-05-20')).toEqual([
      { from: '2026-05-01', until: '2026-05-05' },
      { from: '2026-05-11', until: '2026-05-19' },
    ])
  })

  it('is a no-op when no period is open', () => {
    const r = rule({ periods: [{ from: '2026-05-01', until: '2026-05-08' }] })
    expect(closePeriod(r, '2026-05-20')).toEqual([
      { from: '2026-05-01', until: '2026-05-08' },
    ])
  })

})

// The Progress page hands these the raw calendar day, which over a weekend is
// a Sat/Sun. Boundaries must still land on trading days, and a weekend edit
// must not disturb the week that just closed.
//   2026-05-15 Fri · 05-16 Sat · 05-17 Sun · 05-18 Mon · 05-19 Tue
describe('weekend anchoring', () => {
  it('opens on Monday when the rule is switched on over the weekend', () => {
    expect(openPeriod(rule({ periods: [] }), '2026-05-16')).toEqual([
      { from: '2026-05-18', until: null },
    ])
    expect(openPeriod(rule({ periods: [] }), '2026-05-17')).toEqual([
      { from: '2026-05-18', until: null },
    ])
  })

  it('leaves the just-ended week intact when a rule is retired on a weekend', () => {
    const r = rule({ periods: [{ from: '2026-05-11', until: null }] })
    // Friday still counts it — that day was journalled with the rule in force.
    expect(closePeriod(r, '2026-05-16')).toEqual([
      { from: '2026-05-11', until: '2026-05-15' },
    ])
    expect(closePeriod(r, '2026-05-17')).toEqual([
      { from: '2026-05-11', until: '2026-05-15' },
    ])
  })

  it('closes at Friday, not Sunday, when retired on a Monday', () => {
    const r = rule({ periods: [{ from: '2026-05-11', until: null }] })
    expect(closePeriod(r, '2026-05-18')).toEqual([
      { from: '2026-05-11', until: '2026-05-15' },
    ])
  })

  it('treats on-then-off over the weekend as a no-op', () => {
    const r = rule({ periods: openPeriod(rule({ periods: [] }), '2026-05-16') })
    expect(closePeriod(r, '2026-05-16')).toEqual([])
  })

  it('keeps a rule opened Friday and retired Saturday on the Friday', () => {
    const r = rule({ periods: [{ from: '2026-05-15', until: null }] })
    expect(closePeriod(r, '2026-05-16')).toEqual([
      { from: '2026-05-15', until: '2026-05-15' },
    ])
    expect(ruleActiveOn(rule({ periods: closePeriod(r, '2026-05-16') }), '2026-05-15')).toBe(true)
  })

  it('never writes a weekend boundary, whichever day it is called on', () => {
    const days = ['2026-05-15', '2026-05-16', '2026-05-17', '2026-05-18', '2026-05-19']
    for (const today of days) {
      const opened = openPeriod(rule({ periods: [] }), today)
      expect(isWeekend(dateKeyToDate(opened[0].from))).toBe(false)
      const closed = closePeriod(rule({ periods: [{ from: '2026-05-04', until: null }] }), today)
      expect(isWeekend(dateKeyToDate(closed[0].until!))).toBe(false)
    }
  })
})
