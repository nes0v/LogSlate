import type { Side, Session } from '@/db/types'
import { SESSIONS, SIDES } from '@/db/types'
import type { HoldBucket, Weekday } from '@/lib/filters'
import { HOLD_BUCKETS, WEEKDAYS } from '@/lib/filters'
import type { TradeOutcome } from '@/lib/trade-math'
import { TRADE_OUTCOMES } from '@/lib/trade-math'

// Canonical option lists for the All-prefixed Pills selectors used on
// Stats, Reports, and the Models editor. `null` is the "All" sentinel; the
// members come straight from each enum so the lists can't drift from it.
// (Symbol options are per-account and built dynamically in StatsFilterBar.)

export const SESSION_OPTS = [
  { value: null, label: 'All' },
  ...SESSIONS.map(s => ({ value: s, label: s })),
] satisfies Array<{ value: Session | null; label: string }>

export const OUTCOME_OPTS = [
  { value: null, label: 'All' },
  ...TRADE_OUTCOMES.map(o => ({ value: o, label: o })),
] satisfies Array<{ value: TradeOutcome | null; label: string }>

export const SIDE_OPTS = [
  { value: null, label: 'All' },
  ...SIDES.map(s => ({ value: s, label: s })),
] satisfies Array<{ value: Side | null; label: string }>

// Trading-week only — Sat/Sun are still valid `Weekday` values (used by
// `applyFilters`) but the filter UI doesn't surface them since the markets
// aren't open on the weekend. Derived from the canonical `WEEKDAYS` order
// so it can't drift.
const WEEKDAY_ORDER = WEEKDAYS.filter(d => d !== 'sun' && d !== 'sat')
export const WEEKDAY_OPTS = [
  { value: null, label: 'All' },
  ...WEEKDAY_ORDER.map(d => ({ value: d, label: d })),
] satisfies Array<{ value: Weekday | null; label: string }>

export const HOLD_OPTS = [
  { value: null, label: 'All' },
  ...HOLD_BUCKETS.map(b => ({ value: b, label: b })),
] satisfies Array<{ value: HoldBucket | null; label: string }>
