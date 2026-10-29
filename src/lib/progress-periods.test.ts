import { describe, expect, it } from 'vitest'
import { isWeekend } from 'date-fns'
import { dateKeyToDate } from '@/lib/tz'
import type { ProgressRule, ProgressRulePeriod } from '@/db/types'
import {
  checklistFor,
  closePeriod,
  lastPeriodEnd,
  openPeriod,
  openPeriodStart,
  ruleActiveOn,
  ruleCountsOn,
  ruleHasHistoryBefore,
  tradingDayAfter,
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
    // Both are running; only the second has taken effect by Friday.
    const scheduled = rule({ periods: [{ from: '2026-05-18', until: null }] })
    const live = rule({ periods: [{ from: '2026-05-11', until: null }] })
    const friday = '2026-05-15'
    expect(openPeriodStart(scheduled)! > friday).toBe(true)
    expect(openPeriodStart(live)! > friday).toBe(false)
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
  it('opens on Monday when the rule is opened over the weekend', () => {
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

describe('openPeriod re-opening rather than splitting', () => {
  it('re-opens the last period when no trading day elapsed in between', () => {
    // Retired from Monday's page (closes at Friday), then kept from
    // Friday's page — one uninterrupted run, not two periods meeting on
    // the same day.
    const r = rule({ periods: [{ from: '2026-09-01', until: '2026-09-18' }] })
    expect(openPeriod(r, '2026-09-18')).toEqual([
      { from: '2026-09-01', until: null },
    ])
  })

  it('re-opens across a weekend, where no trading day elapsed either', () => {
    const r = rule({ periods: [{ from: '2026-09-01', until: '2026-09-18' }] })
    expect(openPeriod(r, '2026-09-21')).toEqual([
      { from: '2026-09-01', until: null },
    ])
  })

  it('appends when a trading day passed with the rule archived', () => {
    // Off on Thursday the 17th, back on Friday the 18th: that Thursday is a
    // real gap and has to stay one.
    const r = rule({ periods: [{ from: '2026-09-01', until: '2026-09-16' }] })
    expect(openPeriod(r, '2026-09-18')).toEqual([
      { from: '2026-09-01', until: '2026-09-16' },
      { from: '2026-09-18', until: null },
    ])
  })

  it('re-opens only the latest period, leaving older ones alone', () => {
    const r = rule({
      periods: [
        { from: '2026-06-01', until: '2026-06-30' },
        { from: '2026-09-01', until: '2026-09-18' },
      ],
    })
    expect(openPeriod(r, '2026-09-18')).toEqual([
      { from: '2026-06-01', until: '2026-06-30' },
      { from: '2026-09-01', until: null },
    ])
  })
})

// 2026-05-11 Mon … 2026-05-15 Fri; 2026-05-18 the next Monday.
describe('ruleHasHistoryBefore', () => {
  it('is false for a rule never named', () => {
    expect(ruleHasHistoryBefore(rule(), '2026-05-13')).toBe(false)
  })

  it('is false for a rule that starts on the day itself', () => {
    const r = rule({ periods: [{ from: '2026-05-13', until: null }] })
    expect(ruleHasHistoryBefore(r, '2026-05-13')).toBe(false)
  })

  it('is true once the rule ran on the previous trading day', () => {
    const r = rule({ periods: [{ from: '2026-05-12', until: null }] })
    expect(ruleHasHistoryBefore(r, '2026-05-13')).toBe(true)
  })

  it('counts Friday from the following Monday', () => {
    const r = rule({ periods: [{ from: '2026-05-15', until: null }] })
    expect(ruleHasHistoryBefore(r, '2026-05-18')).toBe(true)
  })

  it('is false for a rule planned for Monday, viewed from Monday', () => {
    const r = rule({ periods: [{ from: '2026-05-18', until: null }] })
    expect(ruleHasHistoryBefore(r, '2026-05-18')).toBe(false)
  })

  it('counts a closed period from the past', () => {
    const r = rule({ periods: [{ from: '2026-05-04', until: '2026-05-06' }] })
    expect(ruleHasHistoryBefore(r, '2026-05-13')).toBe(true)
  })
})

describe('tradingDayAfter', () => {
  it('is the next weekday, Monday from a Friday', () => {
    expect(tradingDayAfter('2026-05-12')).toBe('2026-05-13')
    expect(tradingDayAfter('2026-05-15')).toBe('2026-05-18')
  })
})

describe('ruleCountsOn', () => {
  it('counts a rule in force but never a line', () => {
    const periods = [{ from: '2026-05-11', until: null }]
    expect(ruleCountsOn(rule({ periods }), '2026-05-13')).toBe(true)
    expect(ruleCountsOn(rule({ periods, kind: 'line' }), '2026-05-13')).toBe(false)
  })
})

describe('checklistFor', () => {
  const on: ProgressRulePeriod[] = [{ from: '2026-05-11', until: null }]
  const off: ProgressRulePeriod[] = [{ from: '2026-05-18', until: null }]
  const r = (id: string, periods = on) => rule({ id, periods })
  const line = (id: string, periods = on) => rule({ id, periods, kind: 'line' })
  const ids = (rules: ProgressRule[]) => checklistFor(rules, '2026-05-13').map(x => x.id)

  it('keeps a line between two rules', () => {
    expect(ids([r('a'), line('l'), r('b')])).toEqual(['a', 'l', 'b'])
  })

  it('drops a line at either end', () => {
    expect(ids([line('l1'), r('a'), line('l2')])).toEqual(['a'])
  })

  it('collapses lines left next to each other', () => {
    expect(ids([r('a'), line('l1'), line('l2'), r('b')])).toEqual(['a', 'l1', 'b'])
  })

  it('collapses lines once the rules between them are off that day', () => {
    expect(ids([r('a'), line('l1'), r('x', off), line('l2'), r('b')])).toEqual(['a', 'l1', 'b'])
  })

  it('leaves out a line not in force that day', () => {
    expect(ids([r('a'), line('l', off), r('b')])).toEqual(['a', 'b'])
  })

  it('keeps an archived line on the days it ran', () => {
    const ended = [{ from: '2026-05-11', until: '2026-05-14' }]
    expect(ids([r('a'), { ...line('l', ended), hidden: true }, r('b')])).toEqual(['a', 'l', 'b'])
  })
})
