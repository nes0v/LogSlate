import { describe, expect, it } from 'vitest'
import type { ProgressRule } from '@/db/types'
import {
  closePeriod,
  openPeriod,
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

describe('openPeriod', () => {
  it('appends a new open period when none is open', () => {
    const r = rule({ periods: [{ from: '2026-05-01', until: '2026-05-10' }] })
    expect(openPeriod(r, '2026-05-17')).toEqual([
      { from: '2026-05-01', until: '2026-05-10' },
      { from: '2026-05-17', until: null },
    ])
  })

  it('returns the existing periods unchanged when one is already open', () => {
    const periods = [{ from: '2026-05-11', until: null }]
    const r = rule({ periods })
    expect(openPeriod(r, '2026-05-17')).toEqual(periods)
  })

  it('starts a first period for a brand-new rule', () => {
    expect(openPeriod(rule({ periods: [] }), '2026-05-17')).toEqual([
      { from: '2026-05-17', until: null },
    ])
  })
})

describe('closePeriod', () => {
  it('closes an open period at yesterday', () => {
    const r = rule({ periods: [{ from: '2026-05-11', until: null }] })
    expect(closePeriod(r, '2026-05-17')).toEqual([
      { from: '2026-05-11', until: '2026-05-16' },
    ])
  })

  it('drops a period that was opened earlier today (no effective days)', () => {
    const r = rule({ periods: [{ from: '2026-05-17', until: null }] })
    expect(closePeriod(r, '2026-05-17')).toEqual([])
  })

  it('leaves closed periods untouched while closing the open one', () => {
    const r = rule({
      periods: [
        { from: '2026-05-01', until: '2026-05-05' },
        { from: '2026-05-11', until: null },
      ],
    })
    expect(closePeriod(r, '2026-05-17')).toEqual([
      { from: '2026-05-01', until: '2026-05-05' },
      { from: '2026-05-11', until: '2026-05-16' },
    ])
  })

  it('is a no-op when no period is open', () => {
    const r = rule({ periods: [{ from: '2026-05-01', until: '2026-05-10' }] })
    expect(closePeriod(r, '2026-05-17')).toEqual([
      { from: '2026-05-01', until: '2026-05-10' },
    ])
  })

})
