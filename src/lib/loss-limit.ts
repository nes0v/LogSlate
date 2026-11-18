import type { Account, EquityAdjustment, LossLimit, TradeRecord } from '@/db/types'
import { computeNetPnl } from '@/lib/trade-math'
import { signedAdjustment } from '@/lib/trade-stats'

// Prop-firm loss limit. An eval's balance ($50K) isn't the capital at risk —
// the distance to the loss limit (~$2K) is. The scratch-day band sizes itself
// off that ROOM left above the limit instead of equity when the account has
// one, and the header shows BREACHED once the balance touches it.
//
// The limit only ever goes up. Static: starting balance − max loss. Trailing:
// highest end-of-day balance so far (cash flows included) − max loss, capped
// at the stop balance — once it gets there it stops moving for good.

/** The one reader of an account's loss-limit fields. Stored fields are absent
 *  when unset; this resolves them to the fully specified `LossLimit`. */
export function lossLimitOf(a: Account | undefined): LossLimit {
  return {
    max_loss_usd: a?.max_loss_usd ?? null,
    trailing: a?.trailing ?? false,
    trail_stop_usd: a?.trail_stop_usd ?? null,
  }
}

/** Scratch-day band every account starts on, in percent (0.4 = 0.4%). */
export const DEFAULT_SCRATCH_PCT = 0.4
/** Range of the Settings slider, percent, in 0.1 steps. */
export const MIN_SCRATCH_PCT = 0.2
export const MAX_SCRATCH_PCT = 1.2

/** The one reader of an account's scratch threshold (percent). Clamped to
 *  the slider's range in 0.1 steps: a hand-edited backup can carry any
 *  number, and import doesn't check it. */
export function scratchPctOf(a: Account | undefined): number {
  const v = a?.scratch_pct
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_SCRATCH_PCT
  return Math.round(Math.min(MAX_SCRATCH_PCT, Math.max(MIN_SCRATCH_PCT, v)) * 10) / 10
}

export interface LimitTimeline {
  /** False when the account has no limit: every lookup below returns null. */
  hasLimit: boolean
  /** The limit in force during `date`, i.e. as set by the end of the previous
   *  active day. */
  limitBefore(date: string): number | null
  /** Real account balance entering `date` minus `limitBefore(date)`: how much
   *  can still be lost. Real, not filtered — a filtered view (Reports) must not
   *  shrink or grow it. */
  roomBefore(date: string): number | null
}

const NO_LIMIT: LimitTimeline = {
  hasLimit: false,
  limitBefore: () => null,
  roomBefore: () => null,
}

/**
 * Walks the account's whole history once, recording the balance and limit
 * after each active day. `netByDate` is the account's FULL day → net map
 * (`netPnlByDate` over every trade, overrides folded in) — the same map
 * `equityBefore` reads, so the balance walked here is the balance shown
 * everywhere else.
 */
export function limitTimeline(
  rules: LossLimit,
  startingBalance: number,
  netByDate: Map<string, number>,
  adjustments: EquityAdjustment[],
): LimitTimeline {
  const maxLoss = rules.max_loss_usd
  if (maxLoss === null) return NO_LIMIT
  const initial = startingBalance - maxLoss
  const stop = rules.trail_stop_usd ?? Infinity

  const delta = new Map<string, number>()
  for (const [d, v] of netByDate) delta.set(d, (delta.get(d) ?? 0) + v)
  for (const a of adjustments) {
    delta.set(a.date, (delta.get(a.date) ?? 0) + signedAdjustment(a))
  }
  const dates = [...delta.keys()].sort()
  const balanceAfter: number[] = []
  const limitAfter: number[] = []
  let balance = startingBalance
  let peak = startingBalance
  for (const d of dates) {
    balance += delta.get(d) ?? 0
    if (balance > peak) peak = balance
    balanceAfter.push(balance)
    // `Math.max(initial, …)`: a stop set below the starting limit can't drag
    // the limit down — it only ever rises.
    limitAfter.push(
      rules.trailing ? Math.max(initial, Math.min(peak - maxLoss, stop)) : initial,
    )
  }

  // Count of active days strictly before `date`.
  const daysBefore = (date: string): number => {
    let lo = 0
    let hi = dates.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (dates[mid] < date) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const limitBefore = (date: string): number => {
    const n = daysBefore(date)
    return n === 0 ? initial : limitAfter[n - 1]
  }

  return {
    hasLimit: true,
    limitBefore,
    roomBefore(date) {
      const n = daysBefore(date)
      return (n === 0 ? startingBalance : balanceAfter[n - 1]) - limitBefore(date)
    },
  }
}

/**
 * Whether the balance ever touched the limit. Checked after every closed trade
 * in the order they closed (a trade's last fill), so a mid-day dip that
 * recovers by the close still counts — that's how firms treat it. On an
 * override day the override replaces the trades, which are ignored, and the
 * day is checked on its end-of-day balance. Cash flows land at the start of
 * their day. Once breached, always breached.
 *
 * Partial exits all count at the trade's final fill. That loses nothing: the
 * firm liquidates every position the moment the balance touches the limit, so
 * a breached account can't dip below it mid-trade and close back above — the
 * breaching trade's final fill is itself at or below the limit.
 */
export function isBreached(
  timeline: LimitTimeline,
  startingBalance: number,
  trades: TradeRecord[],
  overrides: Map<string, number>,
  adjustments: EquityAdjustment[],
): boolean {
  if (!timeline.hasLimit) return false
  const tradesByDate = new Map<string, TradeRecord[]>()
  for (const t of trades) {
    const list = tradesByDate.get(t.date)
    if (list) list.push(t)
    else tradesByDate.set(t.date, [t])
  }
  const adjByDate = new Map<string, number>()
  for (const a of adjustments) {
    adjByDate.set(a.date, (adjByDate.get(a.date) ?? 0) + signedAdjustment(a))
  }
  const dates = [
    ...new Set([...tradesByDate.keys(), ...overrides.keys(), ...adjByDate.keys()]),
  ].sort()

  let balance = startingBalance
  for (const d of dates) {
    const limit = timeline.limitBefore(d) ?? -Infinity
    const touched = () => balance <= limit + BREACH_EPSILON
    balance += adjByDate.get(d) ?? 0
    if (touched()) return true
    const override = overrides.get(d)
    if (override !== undefined) {
      balance += override
      if (touched()) return true
      continue
    }
    const closed = [...(tradesByDate.get(d) ?? [])].sort((a, b) =>
      closeTime(a).localeCompare(closeTime(b)),
    )
    for (const t of closed) {
      balance += computeNetPnl(t) ?? 0
      if (touched()) return true
    }
  }
  return false
}

// Float residue from summing cents shouldn't decide a breach.
const BREACH_EPSILON = 1e-6

// Executions are stored time-ascending with full ISO stamps (an evening fill
// carries the previous calendar day), so the last one's string sorts
// chronologically across the 17:00 rollover.
function closeTime(t: TradeRecord): string {
  return t.executions.length ? t.executions[t.executions.length - 1].time : ''
}
