import {
  EMOTIONS,
  RATINGS,
  SESSIONS,
  SIDES,
  type Emotion,
  type Rating,
  type Session,
  type Side,
  type TradeRecord,
} from '@/db/types'
import {
  classifyTrade,
  inferSide,
  TRADE_OUTCOMES,
  type TradeOutcome,
} from '@/lib/trade-math'
import { dateKeyToDate } from '@/lib/tz'

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const HOLD_BUCKETS = [
  '1m',
  '1-5m',
  '5-15m',
  '15-30m',
  '30-60m',
  '1-2h',
  '2-4h',
  '4h+',
] as const
export type HoldBucket = (typeof HOLD_BUCKETS)[number]

const HOLD_BUCKET_RANGES_MIN: Record<HoldBucket, [number, number]> = {
  '1m': [0, 1],
  '1-5m': [1, 5],
  '5-15m': [5, 15],
  '15-30m': [15, 30],
  '30-60m': [30, 60],
  '1-2h': [60, 120],
  '2-4h': [120, 240],
  '4h+': [240, Infinity],
}

/** Holding duration in minutes — first to last execution time. Returns
 *  null when the trade has fewer than two parsable execution times. */
export function holdMinutes(t: TradeRecord): number | null {
  const times = t.executions
    .map(e => Date.parse(e.time))
    .filter(n => !Number.isNaN(n))
  if (times.length < 2) return null
  return (Math.max(...times) - Math.min(...times)) / 60000
}

// Memoized — `applyFilters` calls this for every trade on every filter
// change, and `holdMinutes` re-parses every execution timestamp each
// call. Keyed off the trade record reference: a trade is replaced (not
// mutated in place) on edit, so a fresh ref invalidates naturally.
const holdBucketCache = new WeakMap<TradeRecord, HoldBucket | null>()

export function holdBucketOf(t: TradeRecord): HoldBucket | null {
  const cached = holdBucketCache.get(t)
  if (cached !== undefined) return cached
  const m = holdMinutes(t)
  let bucket: HoldBucket | null = null
  if (m !== null) {
    for (const b of HOLD_BUCKETS) {
      const [lo, hi] = HOLD_BUCKET_RANGES_MIN[b]
      if (m >= lo && m < hi) {
        bucket = b
        break
      }
    }
  }
  holdBucketCache.set(t, bucket)
  return bucket
}

/** Sentinel model id for trades with no `model_id` set. UUIDs never
 *  produce this string, so it can't collide with a real model. */
export const MODEL_NONE = 'none'

export interface TradeFilters {
  from: string | null // YYYY-MM-DD, inclusive
  to: string | null // YYYY-MM-DD, inclusive
  /** TradingSymbol id, or null for "All". Validated against the account's
   *  symbols in the UI; a stale id just matches no trades. */
  symbol_id: string | null
  session: Session | null
  rating: Rating | null
  weekday: Weekday | null
  outcome: TradeOutcome | null
  side: Side | null
  hold: HoldBucket | null
  emotion: Emotion | null
  /** Model id, or `MODEL_NONE` for trades with no model. */
  model: string | null
  /** Single setup_tag string. */
  tag: string | null
}

export const EMPTY_FILTERS: TradeFilters = {
  from: null,
  to: null,
  symbol_id: null,
  session: null,
  rating: null,
  weekday: null,
  outcome: null,
  side: null,
  hold: null,
  emotion: null,
  model: null,
  tag: null,
}

/** True when a filter references a per-trade field that override days don't
 *  have (symbol, session, rating, …) — so day-level overrides can't be
 *  classified against it and must be excluded. `from`/`to` and `weekday` are
 *  deliberately absent: those are date-shaped, and an override day has a date
 *  (hence a weekday), so it still participates in those dimensions. */
export function overridesExcludedByFilters(f: TradeFilters): boolean {
  return !!(
    f.symbol_id || f.session || f.rating ||
    f.outcome || f.side || f.hold || f.emotion || f.model || f.tag
  )
}

/** Keep only the override entries whose date falls on `weekday`. Returns the
 *  map unchanged when no weekday filter is active. Override days carry a real
 *  date, so they're filtered by weekday just like real trading days. */
export function filterOverridesByWeekday(
  overrides: Map<string, number>,
  weekday: Weekday | null,
): Map<string, number> {
  if (!weekday) return overrides
  const out = new Map<string, number>()
  for (const [date, v] of overrides) {
    if (WEEKDAYS[dateKeyToDate(date).getDay()] === weekday) out.set(date, v)
  }
  return out
}

/** URL param carrying the "include override days" intent. Absent = on (the
 *  default); only written as `overrides=0` when the user turns it off. It's a
 *  UI param (not in `FILTER_PARAM_KEYS`), preserved across filter edits/clear
 *  like `tf`/`tab`. */
export const OVERRIDES_PARAM = 'overrides'
export function includeOverridesFromParams(p: URLSearchParams): boolean {
  return p.get(OVERRIDES_PARAM) !== '0'
}

/** URL param carrying the "show scratch trades" intent. Absent = on (the
 *  default); only written as `scratches=0` when the user turns it off. Like
 *  `overrides`, it's a UI param (not in `FILTER_PARAM_KEYS`), preserved across
 *  filter edits/clear. */
export const SCRATCHES_PARAM = 'scratches'
export function includeScratchesFromParams(p: URLSearchParams): boolean {
  return p.get(SCRATCHES_PARAM) !== '0'
}

export function applyFilters(
  trades: TradeRecord[],
  f: TradeFilters,
  // The "Show scratch trades" toggle. When false, scratch trades drop out of
  // every stat/chart entirely (global, like the override-days toggle). Default
  // true so the many other callers (and tests) keep their existing behavior.
  includeScratches = true,
): TradeRecord[] {
  return trades.filter(t => {
    if (f.from && t.date < f.from) return false
    if (f.to && t.date > f.to) return false
    if (f.symbol_id && t.symbol_id !== f.symbol_id) return false
    if (f.session && t.session !== f.session) return false
    if (f.rating && t.rating !== f.rating) return false
    if (f.weekday) {
      const wd = WEEKDAYS[dateKeyToDate(t.date).getDay()]
      if (wd !== f.weekday) return false
    }
    if (!includeScratches && classifyTrade(t) === 'scratch') return false
    if (f.outcome && classifyTrade(t) !== f.outcome) return false
    if (f.side) {
      const s = inferSide(t)
      if (s !== f.side) return false
    }
    if (f.hold && holdBucketOf(t) !== f.hold) return false
    if (f.emotion && t.emotion !== f.emotion) return false
    if (f.model) {
      if (f.model === MODEL_NONE) {
        if (t.model_id) return false
      } else if (t.model_id !== f.model) return false
    }
    if (f.tag) {
      if (!t.setup_tags || !t.setup_tags.includes(f.tag)) return false
    }
    return true
  })
}

export function filtersFromParams(p: URLSearchParams): TradeFilters {
  const get = <K extends string>(key: string, allowed: readonly K[]): K | null => {
    const v = p.get(key)
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as K) : null
  }
  const rawModel = p.get('model')
  const rawSymbol = p.get('symbol')
  return {
    from: p.get('from'),
    to: p.get('to'),
    // Symbol id is a free-form string (UUID) like `model`; the UI validates it
    // against the account's symbols, a stale id just matches no trades.
    symbol_id: rawSymbol && rawSymbol.length > 0 ? rawSymbol : null,
    session: get<Session>('session', SESSIONS),
    rating: get<Rating>('rating', RATINGS),
    weekday: get<Weekday>('weekday', WEEKDAYS),
    outcome: get<TradeOutcome>('outcome', TRADE_OUTCOMES),
    side: get<Side>('side', SIDES),
    hold: get<HoldBucket>('hold', HOLD_BUCKETS),
    emotion: get<Emotion>('emotion', EMOTIONS),
    // Model id is a free-form string (UUID) or the `MODEL_NONE` sentinel.
    // Validation against the user's actual model list happens in the UI;
    // a stale/invalid id just produces no matching trades.
    model: rawModel && rawModel.length > 0 ? rawModel : null,
    tag: p.get('tag'),
  }
}

/** Validates an untrusted object (e.g. a stale or hand-edited localStorage
 *  blob) into a clean TradeFilters. Every enum field is whitelisted against
 *  its allowed set — exactly like `filtersFromParams` does for URL params —
 *  so an invalid or wrong-typed value becomes `null` instead of silently
 *  flowing into `applyFilters` and skewing (or emptying) results. */
export function coerceFilters(raw: unknown): TradeFilters {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...EMPTY_FILTERS }
  }
  const o = raw as Record<string, unknown>
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null
  const oneOf = <K extends string>(v: unknown, allowed: readonly K[]): K | null =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as K) : null
  return {
    from: str(o.from),
    to: str(o.to),
    symbol_id: str(o.symbol_id),
    session: oneOf<Session>(o.session, SESSIONS),
    rating: oneOf<Rating>(o.rating, RATINGS),
    weekday: oneOf<Weekday>(o.weekday, WEEKDAYS),
    outcome: oneOf<TradeOutcome>(o.outcome, TRADE_OUTCOMES),
    side: oneOf<Side>(o.side, SIDES),
    hold: oneOf<HoldBucket>(o.hold, HOLD_BUCKETS),
    emotion: oneOf<Emotion>(o.emotion, EMOTIONS),
    model: str(o.model),
    tag: str(o.tag),
  }
}

/** URL-param names that map to a TradeFilters dimension. The Stats/Reports
 *  pages use this to count "active" filters (non-default URL state) so the
 *  filter bar opens/closes its collapsible appropriately. */
export const FILTER_PARAM_KEYS = [
  'from',
  'to',
  'symbol',
  'session',
  'rating',
  'weekday',
  'outcome',
  'side',
  'hold',
  'emotion',
  'model',
  'tag',
] as const

export function paramsFromFilters(f: TradeFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.symbol_id) p.set('symbol', f.symbol_id)
  if (f.session) p.set('session', f.session)
  if (f.rating) p.set('rating', f.rating)
  if (f.weekday) p.set('weekday', f.weekday)
  if (f.outcome) p.set('outcome', f.outcome)
  if (f.side) p.set('side', f.side)
  if (f.hold) p.set('hold', f.hold)
  if (f.emotion) p.set('emotion', f.emotion)
  if (f.model) p.set('model', f.model)
  if (f.tag) p.set('tag', f.tag)
  return p
}
