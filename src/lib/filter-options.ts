import type { Side, Session } from '@/db/types'
import type { HoldBucket, Weekday } from '@/lib/filters'
import { HOLD_BUCKETS } from '@/lib/filters'
import type { TradeOutcome } from '@/lib/trade-math'

// Canonical option lists for the All-prefixed Pills selectors used on
// Stats, Reports, and the Models editor. `null` is the "All" sentinel.
// (Symbol options are per-account and built dynamically in StatsFilterBar.)

export const SESSION_OPTS = [
  { value: null, label: 'All' },
  { value: 'pre' as const, label: 'pre' },
  { value: 'am' as const, label: 'am' },
  { value: 'lunch' as const, label: 'lunch' },
  { value: 'pm' as const, label: 'pm' },
  { value: 'aft' as const, label: 'aft' },
] satisfies Array<{ value: Session | null; label: string }>

export const OUTCOME_OPTS = [
  { value: null, label: 'All' },
  { value: 'win' as const, label: 'win' },
  { value: 'loss' as const, label: 'loss' },
  { value: 'scratch' as const, label: 'scratch' },
] satisfies Array<{ value: TradeOutcome | null; label: string }>

export const SIDE_OPTS = [
  { value: null, label: 'All' },
  { value: 'long' as const, label: 'long' },
  { value: 'short' as const, label: 'short' },
] satisfies Array<{ value: Side | null; label: string }>

// Trading-week only — Sat/Sun are still valid `Weekday` values (used by
// `applyFilters`) but the filter UI doesn't surface them since the markets
// aren't open on the weekend.
const WEEKDAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri'] as const
export const WEEKDAY_OPTS = [
  { value: null, label: 'All' },
  ...WEEKDAY_ORDER.map(d => ({ value: d, label: d })),
] satisfies Array<{ value: Weekday | null; label: string }>

export const HOLD_OPTS = [
  { value: null, label: 'All' },
  ...HOLD_BUCKETS.map(b => ({ value: b, label: b })),
] satisfies Array<{ value: HoldBucket | null; label: string }>
