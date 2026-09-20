import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './schema'
import {
  createProgressRule,
  deleteProgressRule,
  restoreProgressRule,
  setProgressRuleActive,
  toggleProgressCheck,
} from './queries'
import type { ProgressCheck, ProgressRule, ProgressRulePeriod } from './types'

// 2026-09-14 Mon … 2026-09-18 Fri; 2026-09-21 is the following Monday.
const TS = '2026-09-01T00:00:00.000Z'

function rule(id: string, periods: ProgressRulePeriod[]): ProgressRule {
  return {
    id,
    account_id: 'main',
    text: id,
    periods,
    sort: 0,
    created_at: TS,
    updated_at: TS,
  }
}

function check(date: string, ruleId: string): ProgressCheck {
  return {
    id: `main:${date}:${ruleId}`,
    account_id: 'main',
    date,
    rule_id: ruleId,
    checked: true,
    created_at: TS,
    updated_at: TS,
  }
}

const checkDates = async (ruleId: string) =>
  (await db.progress_checks.toArray())
    .filter(c => c.rule_id === ruleId)
    .map(c => c.date)
    .sort()

beforeEach(async () => {
  await db.progress_rules.clear()
  await db.progress_checks.clear()
})

describe('setProgressRuleActive', () => {
  it('opens a period from the day on screen', async () => {
    await db.progress_rules.put(rule('r', []))
    await setProgressRuleActive('r', '2026-09-16', true)
    expect((await db.progress_rules.get('r'))!.periods).toEqual([
      { from: '2026-09-16', until: null },
    ])
  })

  it('retires the rule at the previous trading day', async () => {
    await db.progress_rules.put(rule('r', [{ from: '2026-09-01', until: null }]))
    await setProgressRuleActive('r', '2026-09-16', false)
    expect((await db.progress_rules.get('r'))!.periods).toEqual([
      { from: '2026-09-01', until: '2026-09-15' },
    ])
  })

  it('clears the tick that retiring the rule strands on today', async () => {
    await db.progress_rules.put(rule('r', [{ from: '2026-09-01', until: null }]))
    await db.progress_checks.bulkPut([check('2026-09-15', 'r'), check('2026-09-16', 'r')])
    await setProgressRuleActive('r', '2026-09-16', false)
    // The 15th sits inside the period that survives; the 16th no longer does.
    expect(await checkDates('r')).toEqual(['2026-09-15'])
  })

  it('leaves another rule’s ticks on the same day alone', async () => {
    await db.progress_rules.put(rule('r', [{ from: '2026-09-01', until: null }]))
    await db.progress_rules.put(rule('other', [{ from: '2026-09-01', until: null }]))
    await db.progress_checks.bulkPut([check('2026-09-16', 'r'), check('2026-09-16', 'other')])
    await setProgressRuleActive('r', '2026-09-16', false)
    expect(await checkDates('other')).toEqual(['2026-09-16'])
  })

  it('clears the tick a rule collected in the afternoon it existed for', async () => {
    await db.progress_rules.put(rule('r', []))
    await setProgressRuleActive('r', '2026-09-16', true)
    await db.progress_checks.put(check('2026-09-16', 'r'))
    await setProgressRuleActive('r', '2026-09-16', false)
    expect((await db.progress_rules.get('r'))!.periods).toEqual([])
    expect(await checkDates('r')).toEqual([])
  })

  it('ignores a rule that is already gone', async () => {
    await expect(setProgressRuleActive('nope', '2026-09-16', false)).resolves.toBeUndefined()
  })
})

describe('deleteProgressRule', () => {
  it('deletes a rule nothing in the past depends on', async () => {
    await db.progress_rules.put(rule('r', [{ from: '2026-09-16', until: null }]))
    expect(await deleteProgressRule('r', '2026-09-16')).toBe('deleted')
    expect(await db.progress_rules.get('r')).toBeUndefined()
  })

  it('archives a rule with scored days behind it, keeping those days intact', async () => {
    await db.progress_rules.put(rule('r', [{ from: '2026-09-01', until: null }]))
    await db.progress_checks.put(check('2026-09-15', 'r'))
    expect(await deleteProgressRule('r', '2026-09-16')).toBe('archived')
    const stored = (await db.progress_rules.get('r'))!
    expect(stored.hidden).toBe(true)
    expect(stored.periods).toEqual([{ from: '2026-09-01', until: '2026-09-15' }])
    expect(await checkDates('r')).toEqual(['2026-09-15'])
  })

  it('deletes rather than archives when the only tick is one it strands', async () => {
    // The rule that was switched on and off inside a single session: its
    // period is dropped, so the tick it collected anchors nothing. Archiving
    // it would leave a rule that scored no day at all sitting in the drawer
    // forever.
    await db.progress_rules.put(rule('r', [{ from: '2026-09-16', until: null }]))
    await db.progress_checks.put(check('2026-09-16', 'r'))
    expect(await deleteProgressRule('r', '2026-09-16')).toBe('deleted')
    expect(await db.progress_rules.get('r')).toBeUndefined()
    expect(await db.progress_checks.count()).toBe(0)
  })

  it('reports a rule that is already gone', async () => {
    expect(await deleteProgressRule('nope', '2026-09-16')).toBe('missing')
  })
})

describe('toggleProgressCheck', () => {
  it('ticks, then unticks, deleting the row rather than storing a false', async () => {
    expect(await toggleProgressCheck('main', '2026-09-16', 'r')).toBe(true)
    expect(await db.progress_checks.get('main:2026-09-16:r')).toMatchObject({
      checked: true,
      date: '2026-09-16',
      rule_id: 'r',
    })
    expect(await toggleProgressCheck('main', '2026-09-16', 'r')).toBe(false)
    expect(await db.progress_checks.count()).toBe(0)
  })

  it('reads the stored state, not the caller\u2019s, so a double tap cancels', async () => {
    // Both calls start before either has written: on screen the row still
    // reads unticked for the second one.
    const [first, second] = await Promise.all([
      toggleProgressCheck('main', '2026-09-16', 'r'),
      toggleProgressCheck('main', '2026-09-16', 'r'),
    ])
    expect([first, second]).toEqual([true, false])
    expect(await db.progress_checks.count()).toBe(0)
  })

  it('keeps the original created_at when a tick comes back', async () => {
    await db.progress_checks.put({ ...check('2026-09-16', 'r'), checked: false })
    await toggleProgressCheck('main', '2026-09-16', 'r')
    const row = (await db.progress_checks.get('main:2026-09-16:r'))!
    expect(row.checked).toBe(true)
    expect(row.created_at).toBe(TS)
    expect(row.updated_at > TS).toBe(true)
  })
})

describe('createProgressRule', () => {
  it('lands after the rules already there', async () => {
    await db.progress_rules.bulkPut([
      { ...rule('a', []), sort: 1 },
      { ...rule('b', []), sort: 7 },
    ])
    const made = await createProgressRule('main')
    expect(made.sort).toBe(8)
    expect(made.periods).toEqual([])
    expect(made.text).toBe('')
  })

  it('gives two quick taps two different places in the list', async () => {
    const [one, two] = await Promise.all([
      createProgressRule('main'),
      createProgressRule('main'),
    ])
    expect(one.sort).not.toBe(two.sort)
    expect(await db.progress_rules.count()).toBe(2)
  })

  it('counts only this account\u2019s rules', async () => {
    await db.progress_rules.put({ ...rule('other', []), account_id: 'second', sort: 99 })
    expect((await createProgressRule('main')).sort).toBe(1)
  })
})

describe('restoreProgressRule', () => {
  it('unhides the rule and runs it again from the day on screen', async () => {
    await db.progress_rules.put({
      ...rule('r', [{ from: '2026-09-01', until: '2026-09-11' }]),
      hidden: true,
    })
    await restoreProgressRule('r', '2026-09-16')
    const stored = (await db.progress_rules.get('r'))!
    expect(stored.hidden).toBe(false)
    expect(stored.periods).toEqual([
      { from: '2026-09-01', until: '2026-09-11' },
      { from: '2026-09-16', until: null },
    ])
  })

  it('does not fork the history when the rule is already running', async () => {
    await db.progress_rules.put(rule('r', [{ from: '2026-09-01', until: null }]))
    await restoreProgressRule('r', '2026-09-16')
    expect((await db.progress_rules.get('r'))!.periods).toEqual([
      { from: '2026-09-01', until: null },
    ])
  })
})
