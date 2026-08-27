import { describe, expect, it } from 'vitest'
import type { EquityAdjustment } from '@/db/types'
import { byCreatedThenId, resolveResets } from './adjustment-resets'
import { accountEquity, accountEquityThrough } from './day-pnl'

function adj(overrides: Partial<EquityAdjustment> = {}): EquityAdjustment {
  const now = '2026-08-01T00:00:00.000Z'
  return {
    id: 'a1',
    account_id: 'main',
    date: '2026-08-10',
    kind: 'deposit',
    amount: 1000,
    note: '',
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

const deltaOf = (rows: EquityAdjustment[], id: string) =>
  rows.find(r => r.id === id)?.delta

describe('resolveResets', () => {
  it('returns the input untouched when there are no resets', () => {
    const rows = [adj({ id: 'd1' }), adj({ id: 'w1', kind: 'withdraw' })]
    expect(resolveResets(rows, new Map(), 50_000)).toBe(rows)
  })

  it('derives the step that lands equity on the target', () => {
    // 50k opening, down 2k before the reset date → the step is +2,000.
    const rows = [adj({ id: 'r1', kind: 'reset', amount: 50_000, date: '2026-08-10' })]
    const net = new Map([['2026-08-05', -2000]])
    expect(deltaOf(resolveResets(rows, net, 50_000), 'r1')).toBeCloseTo(2000, 5)
  })

  it('re-derives after a trade is back-logged before the reset', () => {
    // The whole reason a reset stores a target rather than a frozen gap.
    const rows = [adj({ id: 'r1', kind: 'reset', amount: 50_000, date: '2026-08-10' })]
    const before = new Map([['2026-08-05', -2000]])
    expect(deltaOf(resolveResets(rows, before, 50_000), 'r1')).toBeCloseTo(2000, 5)

    const after = new Map([
      ['2026-08-05', -2000],
      ['2026-08-03', -500], // remembered a week later
    ])
    expect(deltaOf(resolveResets(rows, after, 50_000), 'r1')).toBeCloseTo(2500, 5)
    // Either way equity lands exactly on the target.
    expect(accountEquity(after, rows, 50_000)).toBeCloseTo(50_000, 5)
  })

  it('counts the reset day own trades before resetting', () => {
    // You reset BECAUSE that day blew the account up, so the day's damage has
    // to be inside the step, not stranded after it.
    const rows = [adj({ id: 'r1', kind: 'reset', amount: 50_000, date: '2026-08-10' })]
    const net = new Map([['2026-08-10', -2000]])
    expect(deltaOf(resolveResets(rows, net, 50_000), 'r1')).toBeCloseTo(2000, 5)
    expect(accountEquity(net, rows, 50_000)).toBeCloseTo(50_000, 5)
  })

  it('goes negative when rolling a passed eval into a smaller one', () => {
    const rows = [adj({ id: 'r1', kind: 'reset', amount: 50_000, date: '2026-08-10' })]
    const net = new Map([['2026-08-05', 2000]]) // 52k
    expect(deltaOf(resolveResets(rows, net, 50_000), 'r1')).toBeCloseTo(-2000, 5)
  })

  it('folds same-day cash flows in before the reset', () => {
    const rows = [
      adj({ id: 'd1', kind: 'deposit', amount: 500, date: '2026-08-10' }),
      adj({ id: 'r1', kind: 'reset', amount: 50_000, date: '2026-08-10' }),
    ]
    // 50k opening + 500 deposit = 50,500, so landing on 50k is a −500 step.
    expect(deltaOf(resolveResets(rows, new Map(), 50_000), 'r1')).toBeCloseTo(-500, 5)
  })

  it('chains multiple resets, each measured against the one before', () => {
    const rows = [
      adj({ id: 'r1', kind: 'reset', amount: 50_000, date: '2026-08-10' }),
      adj({ id: 'r2', kind: 'reset', amount: 100_000, date: '2026-08-20' }),
    ]
    const net = new Map([
      ['2026-08-05', -2000],
      ['2026-08-15', -1000],
    ])
    const out = resolveResets(rows, net, 50_000)
    expect(deltaOf(out, 'r1')).toBeCloseTo(2000, 5) // 48k → 50k
    expect(deltaOf(out, 'r2')).toBeCloseTo(51_000, 5) // 49k → 100k
    expect(accountEquity(net, rows, 50_000)).toBeCloseTo(100_000, 5)
  })

  it('prices a back-dated reset against equity on that day, not today', () => {
    // The reset lands on the 10th; the 15th's loss happens after it and must
    // not be folded into the step.
    const rows = [adj({ id: 'r1', kind: 'reset', amount: 50_000, date: '2026-08-10' })]
    const net = new Map([
      ['2026-08-05', -2000],
      ['2026-08-15', -700],
    ])
    expect(deltaOf(resolveResets(rows, net, 50_000), 'r1')).toBeCloseTo(2000, 5)
    // On the reset day equity sits exactly on the target...
    expect(accountEquityThrough('2026-08-10', net, rows, 50_000)).toBeCloseTo(50_000, 5)
    // ...and the later loss carries on from there.
    expect(accountEquityThrough('2026-08-15', net, rows, 50_000)).toBeCloseTo(49_300, 5)
  })

  it('resolves a reset inside the window using history from outside it', () => {
    // `accountEquityThrough` cuts by date AFTER resolving, so the -2000 before
    // the reset still sizes its step even though the cut sits later.
    const rows = [adj({ id: 'r1', kind: 'reset', amount: 50_000, date: '2026-08-10' })]
    const net = new Map([['2026-08-05', -2000]])
    expect(accountEquityThrough('2026-08-31', net, rows, 50_000)).toBeCloseTo(50_000, 5)
    // Cutting before the reset leaves the drawdown showing.
    expect(accountEquityThrough('2026-08-09', net, rows, 50_000)).toBeCloseTo(48_000, 5)
  })

  it('lets the most recently created same-day reset win, not the lowest id', () => {
    // `listAdjustments` reads the [account_id+date] index, which for equal
    // dates falls back to uuid order — so an id-ordered walk would pick the
    // winner at random. Ids here are deliberately reverse to creation order.
    const rows = [
      adj({
        id: 'zzz-typed-first',
        kind: 'reset',
        amount: 50_000,
        date: '2026-08-10',
        created_at: '2026-08-10T10:00:00.000Z',
      }),
      adj({
        id: 'aaa-typed-second',
        kind: 'reset',
        amount: 100_000,
        date: '2026-08-10',
        created_at: '2026-08-10T11:00:00.000Z',
      }),
    ]
    const net = new Map([['2026-08-05', -2000]])
    const out = resolveResets(rows, net, 50_000)
    expect(deltaOf(out, 'zzz-typed-first')).toBeCloseTo(2000, 5) // 48k → 50k
    expect(deltaOf(out, 'aaa-typed-second')).toBeCloseTo(50_000, 5) // 50k → 100k
    // The corrected target is where the account actually ends up.
    expect(accountEquity(net, rows, 50_000)).toBeCloseTo(100_000, 5)
  })

  it('leaves non-reset rows as the very same objects', () => {
    const deposit = adj({ id: 'd1' })
    const rows = [deposit, adj({ id: 'r1', kind: 'reset', amount: 50_000 })]
    const out = resolveResets(rows, new Map(), 50_000)
    expect(out[0]).toBe(deposit)
    expect(out[1]).not.toBe(rows[1])
  })

  it('does not persist a delta onto the stored row', () => {
    const stored = adj({ id: 'r1', kind: 'reset', amount: 50_000 })
    resolveResets([stored], new Map([['2026-08-01', -2000]]), 50_000)
    expect(stored.delta).toBeUndefined()
  })
})

describe('resolveResets — invariants over generated histories', () => {
  // A reset's whole contract is "equity lands on the target". Worked examples
  // can only check the shapes I thought of, so this hammers the walk with
  // randomised histories and asserts the contract directly.
  function lcg(seed: number) {
    let s = seed
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  }

  function generate(rnd: () => number) {
    const dates: string[] = []
    for (let d = 1; d <= 20; d++) dates.push(`2026-06-${String(d).padStart(2, '0')}`)
    const netByDate = new Map<string, number>()
    const adjustments: EquityAdjustment[] = []
    let n = 0
    for (const date of dates) {
      if (rnd() < 0.6) netByDate.set(date, Math.round((rnd() - 0.5) * 4000))
      if (rnd() < 0.25) {
        adjustments.push(
          adj({
            id: `d${n++}`,
            date,
            kind: rnd() < 0.5 ? 'deposit' : 'withdraw',
            amount: Math.round(rnd() * 3000),
          }),
        )
      }
      if (rnd() < 0.2) {
        adjustments.push(
          adj({
            id: `r${n++}`,
            date,
            kind: 'reset',
            amount: Math.round(rnd() * 80_000),
            created_at: `${date}T12:00:00.000Z`,
          }),
        )
      }
    }
    return { netByDate, adjustments }
  }

  it('always lands equity on the last reset target as of that day', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = lcg(seed)
      const startingBalance = Math.round(rnd() * 100_000)
      const { netByDate, adjustments } = generate(rnd)
      const resets = adjustments.filter(a => a.kind === 'reset')
      if (resets.length === 0) continue

      for (const r of resets) {
        // Everything on the reset's own day is already folded in, so equity at
        // the close of that day is the target — unless a LATER reset shares it.
        const sameDayLater = resets.filter(
          o => o.date === r.date && byCreatedThenId(r, o) < 0,
        )
        if (sameDayLater.length > 0) continue
        expect(
          accountEquityThrough(r.date, netByDate, adjustments, startingBalance),
        ).toBeCloseTo(r.amount, 4)
      }
    }
  })

  it('never writes a delta onto a non-reset row, whatever the history', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rnd = lcg(seed)
      const { netByDate, adjustments } = generate(rnd)
      for (const row of resolveResets(adjustments, netByDate, Math.round(rnd() * 50_000))) {
        if (row.kind !== 'reset') expect(row.delta).toBeUndefined()
        else expect(typeof row.delta).toBe('number')
      }
    }
  })

  it('is idempotent — resolving an already-resolved list changes nothing', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rnd = lcg(seed)
      const startingBalance = Math.round(rnd() * 100_000)
      const { netByDate, adjustments } = generate(rnd)
      const once = resolveResets(adjustments, netByDate, startingBalance)
      const twice = resolveResets(once, netByDate, startingBalance)
      expect(twice.map(r => r.delta)).toEqual(once.map(r => r.delta))
    }
  })
})
