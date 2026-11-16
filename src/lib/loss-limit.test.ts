import { describe, expect, it } from 'vitest'
import type { LossLimit } from '@/db/types'
import { isBreached, limitTimeline, lossLimitOf } from './loss-limit'
import { netPnlByDate } from './day-pnl'
import { adjustmentRecord, execution, symbolSnapshot, tradeRecord } from '@/test/fixtures'

const START = 50_000
const trailing: LossLimit = { max_loss_usd: 2000, trailing: true, trail_stop_usd: 50_100 }
const staticLimit: LossLimit = { ...trailing, trailing: false }
const none = lossLimitOf(undefined)

const days = (entries: Array<[string, number]>) => new Map(entries)
const deposit = (date: string, amount: number) =>
  adjustmentRecord({ date, kind: 'deposit', amount })
const withdraw = (date: string, amount: number) =>
  adjustmentRecord({ date, kind: 'withdraw', amount })

// A trade netting exactly `pnl` (point value 1, no fees), its last fill at
// `closeIso` (a full ISO stamp, as stored).
function trade(date: string, pnl: number, closeIso = `${date}T10:00:00.000Z`) {
  return tradeRecord({
    date,
    symbol_spec: symbolSnapshot({ point_value: 1, fee_per_side: 0 }),
    executions: [
      execution({ kind: 'buy', price: 20000, time: `${date}T09:00:00.000Z` }),
      execution({ kind: 'sell', price: 20000 + pnl, time: closeIso }),
    ],
  })
}

describe('lossLimitOf', () => {
  it('resolves absent fields to the unset state', () => {
    expect(none).toEqual({ max_loss_usd: null, trailing: false, trail_stop_usd: null })
  })
})

describe('limitTimeline', () => {
  it('no max loss → no limit, no room', () => {
    const t = limitTimeline(none, START, days([['2026-04-01', 500]]), [])
    expect(t.hasLimit).toBe(false)
    expect(t.limitBefore('2026-04-02')).toBeNull()
    expect(t.roomBefore('2026-04-02')).toBeNull()
  })

  it('an empty history sits at the starting limit and full room', () => {
    const t = limitTimeline(trailing, START, days([]), [])
    expect(t.limitBefore('2026-04-01')).toBe(48_000)
    expect(t.roomBefore('2026-04-01')).toBe(2000)
  })

  it('static limit never moves; room tracks the balance', () => {
    const t = limitTimeline(staticLimit, START, days([['2026-04-01', 1500]]), [])
    expect(t.limitBefore('2026-04-01')).toBe(48_000)
    expect(t.limitBefore('2026-04-02')).toBe(48_000)
    expect(t.roomBefore('2026-04-02')).toBe(3500)
  })

  it('trails the end-of-day high and never goes down', () => {
    const t = limitTimeline(
      trailing,
      START,
      days([
        ['2026-04-01', 1000], // 51,000 → limit 49,000
        ['2026-04-02', -800], // 50,200 → stays 49,000
        ['2026-04-03', 500], //  50,700 → below the 51,000 high, stays
      ]),
      [],
    )
    expect(t.limitBefore('2026-04-01')).toBe(48_000)
    expect(t.limitBefore('2026-04-02')).toBe(49_000)
    expect(t.limitBefore('2026-04-03')).toBe(49_000)
    expect(t.roomBefore('2026-04-03')).toBe(1200)
  })

  it('a date between or after active days reads the last day before it', () => {
    const t = limitTimeline(trailing, START, days([['2026-04-01', 1000], ['2026-04-06', 500]]), [])
    expect(t.limitBefore('2026-04-03')).toBe(49_000) // gap day
    expect(t.limitBefore('2026-04-06')).toBe(49_000) // the day itself: before it
    expect(t.limitBefore('2026-05-01')).toBe(49_500) // after the last day
    expect(t.roomBefore('2026-05-01')).toBe(2000)
  })

  it('stops trailing at the stop balance', () => {
    const t = limitTimeline(
      trailing,
      START,
      days([
        ['2026-04-01', 2100], // 52,100 → limit reaches 50,100
        ['2026-04-02', 900], //  53,000 → would be 51,000, stopped at 50,100
      ]),
      [],
    )
    expect(t.limitBefore('2026-04-02')).toBe(50_100)
    expect(t.limitBefore('2026-04-03')).toBe(50_100)
    expect(t.roomBefore('2026-04-03')).toBe(2900)
  })

  it('a stop below the starting limit cannot drag the limit down', () => {
    const t = limitTimeline({ ...trailing, trail_stop_usd: 40_000 }, START, days([['2026-04-01', 500]]), [])
    expect(t.limitBefore('2026-04-01')).toBe(48_000)
    expect(t.limitBefore('2026-04-02')).toBe(48_000)
  })

  it("a day's own high doesn't move that day's limit", () => {
    const t = limitTimeline(trailing, START, days([['2026-04-01', 1500]]), [])
    expect(t.limitBefore('2026-04-01')).toBe(48_000)
    expect(t.limitBefore('2026-04-02')).toBe(49_500)
  })

  it('an override day trails like any other day', () => {
    // −5,000 of trades replaced by a +1,000 override.
    const net = netPnlByDate([trade('2026-04-01', -5000)], new Map([['2026-04-01', 1000]]))
    const t = limitTimeline(trailing, START, net, [])
    expect(t.limitBefore('2026-04-02')).toBe(49_000)
  })

  it("room entering a day leaves out that day's own cash flow", () => {
    const t = limitTimeline(staticLimit, START, days([]), [deposit('2026-04-01', 500)])
    expect(t.roomBefore('2026-04-01')).toBe(2000)
    expect(t.roomBefore('2026-04-02')).toBe(2500)
  })

  it('a deposit raises the high; a withdrawal never lowers the limit', () => {
    const t = limitTimeline({ ...trailing, trail_stop_usd: null }, START, days([]), [
      deposit('2026-04-01', 1000),
      withdraw('2026-04-02', 1000),
    ])
    expect(t.limitBefore('2026-04-02')).toBe(49_000)
    expect(t.limitBefore('2026-04-03')).toBe(49_000)
    expect(t.roomBefore('2026-04-03')).toBe(1000)
  })
})

describe('isBreached', () => {
  const check = (
    rules: LossLimit,
    trades: ReturnType<typeof trade>[],
    overrides = new Map<string, number>(),
    adjustments: ReturnType<typeof deposit>[] = [],
  ) => {
    const t = limitTimeline(rules, START, netPnlByDate(trades, overrides), adjustments)
    return isBreached(t, START, trades, overrides, adjustments)
  }

  it('a mid-day dip to the limit breaches even if the day recovers', () => {
    const trades = [
      trade('2026-04-01', 1500, '2026-04-01T15:00:00.000Z'),
      trade('2026-04-01', -2000, '2026-04-01T10:00:00.000Z'), // closes first: 48,000
    ]
    expect(check(staticLimit, trades)).toBe(true)
  })

  it('orders an evening fill (previous calendar day) before the morning', () => {
    // Filed under 04-02 but closed at 18:30 on 04-01 — it came first.
    const trades = [
      trade('2026-04-02', 3000, '2026-04-02T10:00:00.000Z'),
      trade('2026-04-02', -2000, '2026-04-01T18:30:00.000Z'),
    ]
    expect(check(staticLimit, trades)).toBe(true)
  })

  it('stays breached after recovering on later days', () => {
    const trades = [trade('2026-04-01', -2000), trade('2026-04-02', 5000)]
    expect(check(staticLimit, trades)).toBe(true)
  })

  it('not breached while above the limit', () => {
    expect(check(staticLimit, [trade('2026-04-01', -1999)])).toBe(false)
  })

  it('float residue at the limit still counts as touching it', () => {
    const trades = [
      trade('2026-04-01', -0.1, '2026-04-01T10:00:00.000Z'),
      trade('2026-04-01', -0.2, '2026-04-01T10:01:00.000Z'),
      trade('2026-04-01', -1999.7, '2026-04-01T10:02:00.000Z'),
    ]
    expect(check(staticLimit, trades)).toBe(true)
  })

  it('uses the trailed limit in force that day', () => {
    // Day 1 high 51,000 → limit 49,000. Day 2 drops to 49,000.
    const trades = [trade('2026-04-01', 1000), trade('2026-04-02', -2000)]
    expect(check(trailing, trades)).toBe(true)
    expect(check(staticLimit, trades)).toBe(false)
  })

  it('checks override days on their end-of-day balance', () => {
    expect(check(staticLimit, [], new Map([['2026-04-01', -2000]]))).toBe(true)
  })

  it("an override replaces the day's trades", () => {
    const trades = [trade('2026-04-01', -5000)]
    expect(check(staticLimit, trades, new Map([['2026-04-01', 100]]))).toBe(false)
  })

  it('a withdrawal alone can breach', () => {
    expect(check(staticLimit, [], undefined, [withdraw('2026-04-01', 2000)])).toBe(true)
  })

  it("cash flows land before the day's trades", () => {
    // Withdraw 1,500 then lose 500: 48,000 after the trade.
    const trades = [trade('2026-04-01', -500)]
    expect(check(staticLimit, trades, undefined, [withdraw('2026-04-01', 1500)])).toBe(true)
    // Deposit first, so the same loss stays clear.
    expect(check(staticLimit, [trade('2026-04-01', -2000)], undefined, [deposit('2026-04-01', 1)])).toBe(false)
  })

  it('a trade with no fills adds nothing', () => {
    const empty = tradeRecord({ date: '2026-04-01', executions: [] })
    expect(check(staticLimit, [empty, trade('2026-04-01', -1999)])).toBe(false)
  })

  it('never breaches without a limit', () => {
    expect(check(none, [trade('2026-04-01', -40_000)])).toBe(false)
  })
})
