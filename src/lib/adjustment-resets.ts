import type { EquityAdjustment } from '@/db/types'
import { signedAdjustment } from '@/lib/trade-stats'

/**
 * Creation order for rows sharing a date, with `id` as a deterministic
 * tie-break. Reset rows on the same day overwrite each other, so "which one
 * wins" has to mean "the one typed last" — and `listAdjustments` reads the
 * `[account_id+date]` index, which for equal dates falls back to primary-key
 * (uuid) order. Sorting on that would pick a winner at random.
 */
export function byCreatedThenId(a: EquityAdjustment, b: EquityAdjustment): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Fills in the `delta` on every `reset` row: the signed step that lands equity
 * exactly on that row's target.
 *
 * A reset stores WHERE equity should be, not how far it moved, because those
 * two stop agreeing the moment history changes. Blow a 50k eval down to 48k and
 * reset: the step is +2,000 today. Log a forgotten −500 trade dated last week
 * and the step has to become +2,500 or the account quietly reads 49,500 while
 * the prop firm says 50,000. Deriving it here — every time, from whatever the
 * history currently is — is what keeps that self-correcting.
 *
 * Everything downstream stays purely additive: callers run this once where they
 * load the raw array, and every `signedAdjustment` sum below them is unchanged.
 *
 * Ordering within the reset's own day: that day's trades and cash flows land
 * FIRST, the reset last. You reset *because* the day blew the account up, so
 * the reset has to see that day's damage — otherwise resetting on the same day
 * you blew up leaves you short by exactly that day's loss.
 *
 * Rows are returned in the input's order; only reset rows are new objects.
 */
export function resolveResets(
  adjustments: EquityAdjustment[],
  netByDate: Map<string, number>,
  startingBalance: number,
): EquityAdjustment[] {
  // Overwhelmingly the common case — skip the walk, and `some` short-circuits
  // without building an array the way a filter-and-count would.
  if (!adjustments.some(a => a.kind === 'reset')) return adjustments

  const dates = new Set<string>()
  for (const a of adjustments) dates.add(a.date)
  for (const d of netByDate.keys()) dates.add(d)
  const ordered = [...dates].sort()

  const byDate = new Map<string, EquityAdjustment[]>()
  for (const a of adjustments) {
    const list = byDate.get(a.date)
    if (list) list.push(a)
    else byDate.set(a.date, [a])
  }

  const deltaById = new Map<string, number>()
  let equity = startingBalance
  for (const date of ordered) {
    const sameDay = byDate.get(date) ?? []
    for (const a of sameDay) {
      if (a.kind !== 'reset') equity += signedAdjustment(a)
    }
    equity += netByDate.get(date) ?? 0
    // Several resets on one day each overwrite the last, so the account ends up
    // on the target typed most recently. Every earlier one resolves to the step
    // it would have taken, which keeps the arithmetic total honest even though
    // only the final target is where equity lands.
    for (const a of sameDay.filter(r => r.kind === 'reset').sort(byCreatedThenId)) {
      deltaById.set(a.id, a.amount - equity)
      equity = a.amount
    }
  }

  return adjustments.map(a =>
    a.kind === 'reset' ? { ...a, delta: deltaById.get(a.id) ?? 0 } : a,
  )
}
