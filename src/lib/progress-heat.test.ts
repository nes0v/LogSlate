import { describe, expect, it } from 'vitest'
import { isWeekend } from 'date-fns'
import { dateKeyToDate } from '@/lib/tz'
import type { ProgressCheck, ProgressRule } from '@/db/types'
import {
  averageAdherence,
  buildHeat,
  currentStreak,
  heatDays,
  type HeatCell,
} from './progress-heat'

function rule(id = 'r1', overrides: Partial<ProgressRule> = {}): ProgressRule {
  return {
    id,
    account_id: 'main',
    text: 'Test rule',
    periods: [{ from: '2026-01-01', until: null }],
    sort: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function check(date: string, ruleId: string, checked = true): ProgressCheck {
  return {
    id: `main:${date}:${ruleId}`,
    account_id: 'main',
    date,
    rule_id: ruleId,
    checked,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function cell(overrides: Partial<HeatCell> = {}): HeatCell {
  return { date: '2026-09-18', pct: 1, checked: 1, total: 1, future: false, ...overrides }
}

// 2026-09-18 is a Friday, 2026-09-21 a Monday.
describe('heatDays', () => {
  it('returns 30 weekdays, oldest first, ending on the given day', () => {
    const days = heatDays('2026-09-18')
    expect(days).toHaveLength(30)
    expect(days[29]).toBe('2026-09-18')
    expect(days.every(d => !isWeekend(dateKeyToDate(d)))).toBe(true)
    expect([...days].sort()).toEqual(days)
  })

  it('walks back past a weekend without counting it', () => {
    const days = heatDays('2026-09-21', 3)
    expect(days).toEqual(['2026-09-17', '2026-09-18', '2026-09-21'])
  })

  it('ends on the last weekday before a weekend date', () => {
    // Nothing navigates to a Saturday, but the strip must not break if a
    // stored date ever does.
    expect(heatDays('2026-09-19', 1)).toEqual(['2026-09-18'])
  })
})

describe('buildHeat', () => {
  it('scores each day against the rules active on that day', () => {
    const rules = [
      rule('a', { periods: [{ from: '2026-01-01', until: null }] }),
      // Retired mid-window: counts on the 16th, gone by the 18th.
      rule('b', { periods: [{ from: '2026-01-01', until: '2026-09-17' }] }),
    ]
    const heat = buildHeat({
      date: '2026-09-18',
      today: '2026-09-18',
      rules,
      checks: [check('2026-09-16', 'a'), check('2026-09-16', 'b'), check('2026-09-18', 'a')],
      count: 3,
    })
    expect(heat.map(h => [h.date, h.checked, h.total, h.pct])).toEqual([
      ['2026-09-16', 2, 2, 1],
      ['2026-09-17', 0, 2, 0],
      ['2026-09-18', 1, 1, 1],
    ])
  })

  it('ignores an unticked row and a tick for a rule not active that day', () => {
    const rules = [rule('a')]
    const heat = buildHeat({
      date: '2026-09-18',
      today: '2026-09-18',
      rules,
      checks: [check('2026-09-18', 'a', false), check('2026-09-18', 'gone')],
      count: 1,
    })
    expect(heat[0]).toMatchObject({ checked: 0, total: 1, pct: 0 })
  })

  it('flags a session that has not happened instead of scoring it 0', () => {
    const heat = buildHeat({
      date: '2026-09-21',
      today: '2026-09-18',
      rules: [rule('a'), rule('b')],
      checks: [],
      count: 2,
    })
    expect(heat[0]).toMatchObject({ date: '2026-09-18', future: false })
    // The rules are known — only the score is not.
    expect(heat[1]).toMatchObject({ date: '2026-09-21', future: true, total: 2, checked: 0 })
  })
})

describe('currentStreak', () => {
  const rules = [rule('a'), rule('b', { periods: [{ from: '2026-01-01', until: null }] })]
  const perfect = (days: string[]) =>
    days.flatMap(d => [check(d, 'a'), check(d, 'b')])

  it('counts consecutive trailing 100% traded days', () => {
    const days = ['2026-09-16', '2026-09-17', '2026-09-18']
    expect(
      currentStreak({
        date: '2026-09-18',
        today: '2026-09-18',
        rules,
        checks: perfect(days),
        tradedDays: new Set(days),
      }),
    ).toBe(3)
  })

  it('counts past the 30 cells the strip can show', () => {
    // Two perfect months used to read the same as one: the walk was over the
    // heat strip, so it stopped at its 30th cell.
    const days = heatDays('2026-09-18', 45)
    expect(
      currentStreak({
        date: '2026-09-18',
        today: '2026-09-18',
        rules,
        checks: perfect(days),
        tradedDays: new Set(days),
      }),
    ).toBe(45)
  })

  it('breaks on a traded day that missed a rule', () => {
    const days = ['2026-09-16', '2026-09-17', '2026-09-18']
    const checks = perfect(days).filter(
      c => !(c.date === '2026-09-17' && c.rule_id === 'b'),
    )
    expect(
      currentStreak({
        date: '2026-09-18',
        today: '2026-09-18',
        rules,
        checks,
        tradedDays: new Set(days),
      }),
    ).toBe(1)
  })

  it('breaks on a traded day that had no active rules', () => {
    const days = ['2026-09-17', '2026-09-18']
    const late = [rule('a', { periods: [{ from: '2026-09-18', until: null }] })]
    expect(
      currentStreak({
        date: '2026-09-18',
        today: '2026-09-18',
        rules: late,
        checks: [check('2026-09-18', 'a')],
        tradedDays: new Set(days),
      }),
    ).toBe(1)
  })

  it('skips untraded weekdays and weekends rather than breaking on them', () => {
    // Traded Fri 11th and Fri 18th only, both perfect; the week between has
    // no trades at all, and a weekend sits in the middle.
    const days = ['2026-09-11', '2026-09-18']
    expect(
      currentStreak({
        date: '2026-09-18',
        today: '2026-09-18',
        rules,
        checks: perfect(days),
        tradedDays: new Set(days),
      }),
    ).toBe(2)
  })

  it('is not broken by standing on the next session', () => {
    const days = ['2026-09-17', '2026-09-18']
    expect(
      currentStreak({
        date: '2026-09-21',
        today: '2026-09-18',
        rules,
        // Even a trade misdated into that session can't score it.
        checks: perfect(days),
        tradedDays: new Set([...days, '2026-09-21']),
      }),
    ).toBe(2)
  })

  it('is zero when nothing was ever traded', () => {
    expect(
      currentStreak({
        date: '2026-09-18',
        today: '2026-09-18',
        rules,
        checks: perfect(['2026-09-18']),
        tradedDays: new Set<string>(),
      }),
    ).toBe(0)
  })
})

describe('averageAdherence', () => {
  it('averages traded weekdays that had rules', () => {
    const heat = [
      cell({ date: '2026-09-16', pct: 1 }),
      cell({ date: '2026-09-17', pct: 0.5, checked: 1, total: 2 }),
      cell({ date: '2026-09-18', pct: 0, checked: 0, total: 2 }),
    ]
    expect(averageAdherence(heat, new Set(['2026-09-16', '2026-09-17']))).toBe(0.75)
  })

  it('ignores days with no rules and days that were not traded', () => {
    const heat = [
      cell({ date: '2026-09-17', pct: 0, checked: 0, total: 0 }),
      cell({ date: '2026-09-18', pct: 1 }),
    ]
    expect(averageAdherence(heat, new Set(['2026-09-17', '2026-09-18']))).toBe(1)
  })

  it('ignores a session that has not happened', () => {
    const heat = [
      cell({ date: '2026-09-18', pct: 1 }),
      cell({ date: '2026-09-21', pct: 0, checked: 0, total: 2, future: true }),
    ]
    expect(averageAdherence(heat, new Set(['2026-09-18', '2026-09-21']))).toBe(1)
  })

  it('returns null when nothing in the window is scorable', () => {
    expect(averageAdherence([cell({ date: '2026-09-18' })], new Set())).toBeNull()
  })
})
