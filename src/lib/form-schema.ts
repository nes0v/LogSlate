import { z } from 'zod'
import {
  CONTRACT_TYPES,
  EMOTIONS,
  EXECUTION_KINDS,
  ORDER_TYPES,
  RATINGS,
  SYMBOLS,
  type Session,
  type TradeDraft,
  type TradeRecord,
} from '@/db/types'

// Session bands as half-open intervals [previous endMin, endMin) of minutes
// since midnight, NY-local. The implicit start of each band is the previous
// row's `endMin`; pre starts at 0, aft runs to end-of-day.
const SESSION_BANDS: ReadonlyArray<{ session: Session; endMin: number }> = [
  { session: 'pre',   endMin: 9 * 60 + 30 },   // [00:00, 09:30)
  { session: 'am',    endMin: 11 * 60 + 30 },  // [09:30, 11:30)
  { session: 'lunch', endMin: 13 * 60 + 30 },  // [11:30, 13:30)
  { session: 'pm',    endMin: 17 * 60 },       // [13:30, 17:00)
  { session: 'aft',   endMin: 24 * 60 },       // [17:00, 24:00)
]

// Promote to the next session if the trade opened within the last
// `PROMOTE_OPEN_GRACE_MIN` minutes of its session AND closed at least
// `PROMOTE_CLOSE_THRESHOLD_MIN` minutes past the next session's start.
const PROMOTE_OPEN_GRACE_MIN = 15
const PROMOTE_CLOSE_THRESHOLD_MIN = 30

function timeToMin(t: string): number {
  const [hh, mm = '0'] = t.split(':')
  return Number(hh) * 60 + Number(mm)
}

// Decides which session a trade "belongs to". Default = the session the
// trade opened in. Promoted one step to the next session when the open
// happened in the last 15 minutes of its session AND the close happened
// ≥ 30 minutes past the next session's start.
//
// Why: traders often anticipate the upcoming session and front-run it
// with a position opened in the tail of the current session — that trade
// is logically "the next session's", not the one it timestamped into.
//
// Promotion never chains — even a trade spanning multiple sessions only
// checks the open's immediate next session. `aft` has no next, so it
// never promotes. Times are HH:MM[:SS]; seconds are truncated.
export function detectSession(openTime: string, closeTime: string): Session {
  const openMin = timeToMin(openTime)
  const closeMin = timeToMin(closeTime)
  const idx = SESSION_BANDS.findIndex(b => openMin < b.endMin)
  if (idx < 0) return 'aft'
  const open = SESSION_BANDS[idx]
  const next = SESSION_BANDS[idx + 1]
  if (!next) return open.session

  // Inclusive distance from openMin to the session's last minute (endMin-1).
  const minsBeforeSessionEnd = open.endMin - 1 - openMin
  if (minsBeforeSessionEnd > PROMOTE_OPEN_GRACE_MIN) return open.session

  // Next session starts at the current session's endMin (bands are contiguous).
  const minsAfterNextStart = closeMin - open.endMin
  if (minsAfterNextStart < PROMOTE_CLOSE_THRESHOLD_MIN) return open.session

  return next.session
}

// `null` is used as the "blank" form state so number inputs render empty
// rather than pre-filled with 0/1. `.refine` then enforces non-null +
// positive on submit.
const requiredPositive = (msg: string) =>
  z
    .number()
    .nullable()
    .refine((v): v is number => v !== null && v > 0, { message: msg })

const requiredPositiveInt = (msg: string) =>
  z
    .number()
    .nullable()
    .refine((v): v is number => v !== null && Number.isInteger(v) && v > 0, { message: msg })

const executionSchema = z.object({
  kind: z.enum(EXECUTION_KINDS),
  order_type: z.enum(ORDER_TYPES),
  price: requiredPositive('price must be > 0'),
  time: z
    .string()
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d?)?$/,
      'time must be HH:MM (24h, optional :SS)',
    )
    // Pad partial input to canonical HH:MM:SS so downstream (`formToDraft`,
    // duration math) always sees a complete time. Right-aligned padding
    // matches the input's onBlur behavior: "13:30" → "13:30:00", "13:30:4"
    // → "13:30:40".
    .transform(t => {
      const parts = t.split(':')
      const ss = (parts[2] ?? '').padEnd(2, '0')
      return `${parts[0]}:${parts[1]}:${ss}`
    }),
  contracts: requiredPositiveInt('contracts must be a positive integer'),
})

export const tradeFormSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid date'),
    // Symbol/contract/session/rating start blank on new trades so the user
    // makes an explicit choice rather than silently submitting a default.
    // Required on submit via the superRefine below.
    symbol: z.enum(SYMBOLS).nullable(),
    contract_type: z.enum(CONTRACT_TYPES).nullable(),
    idea: z.string(),
    executions: z.array(executionSchema).min(2, 'at least one buy and one sell'),
    stop_loss: requiredPositive('stop loss must be > 0'),
    drawdown: z.number().min(0, 'must be ≥ 0').nullable(),
    buildup: z.number().min(0, 'must be ≥ 0').nullable(),
    rating: z.enum(RATINGS).nullable(),
    // Journaling fields. The form supplies defaults so RHF resolves them;
    // downstream code treats them as optional / nullable.
    profit_target: requiredPositive('profit target must be > 0'),
    notes: z.string(),
    setup_tags: z.array(z.string()),
    emotion: z.enum(EMOTIONS).nullable(),
    model_id: z.string().nullable(),
    model_rules_followed: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if (!v.symbol) {
      ctx.addIssue({ code: 'custom', path: ['symbol'], message: 'pick a symbol' })
    }
    if (!v.contract_type) {
      ctx.addIssue({ code: 'custom', path: ['contract_type'], message: 'pick a contract' })
    }
    if (!v.rating) {
      ctx.addIssue({ code: 'custom', path: ['rating'], message: 'pick a rating' })
    }
    if (!v.emotion) {
      ctx.addIssue({ code: 'custom', path: ['emotion'], message: 'pick an emotion' })
    }
    const buys = v.executions.filter(e => e.kind === 'buy')
    const sells = v.executions.filter(e => e.kind === 'sell')
    if (buys.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['executions'], message: 'at least one buy required' })
    }
    if (sells.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['executions'], message: 'at least one sell required' })
    }
    const buyTotal = buys.reduce((n, e) => n + e.contracts, 0)
    const sellTotal = sells.reduce((n, e) => n + e.contracts, 0)
    if (buys.length > 0 && sells.length > 0 && buyTotal !== sellTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['executions'],
        message: `buy contracts (${buyTotal}) must equal sell contracts (${sellTotal})`,
      })
    }
  })

// Use `z.input<>` (not `z.infer<>`/`z.output<>`) so partially-filled
// form state is valid — required-positive fields are nullable on input
// (the user hasn't typed yet) and only narrow to `number` after parse.
// `formToDraft` runs after validation succeeds and casts where needed.
export type TradeFormValues = z.input<typeof tradeFormSchema>

// Combine a calendar date and a NY wallclock time into a single ISO string.
// The app treats every typed time as NY — no timezone conversion happens at
// store/read time. The trailing `Z` makes the string round-trip cleanly
// through Date/Date.parse for sorting and duration math; the underlying
// "instant" is fictional but globally consistent for every execution row.
function toIso(date: string, time: string): string {
  return `${date}T${time}.000Z`
}

export function formToDraft(v: TradeFormValues): TradeDraft {
  // After zod validation the required-positive fields are guaranteed
  // non-null; refine's type guards don't propagate through zod's inferred
  // type, so we narrow here at the boundary.
  const executions = v.executions
    .map(e => ({
      kind: e.kind,
      order_type: e.order_type,
      price: e.price as number,
      time: toIso(v.date, e.time),
      contracts: e.contracts as number,
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))

  // Session is auto-detected from the open + close times (earliest +
  // latest of the executions). Lexical sort on HH:MM:SS works because
  // they all share the same date.
  let earliest: string | null = null
  let latest: string | null = null
  for (const e of v.executions) {
    if (earliest === null || e.time < earliest) earliest = e.time
    if (latest === null || e.time > latest) latest = e.time
  }
  if (earliest === null || latest === null) {
    // Zod's `.min(2)` upstream guarantees this never happens, but stay
    // defensive so a regression in validation doesn't crash here.
    earliest = '00:00:00'
    latest = '00:00:00'
  }
  const session = detectSession(earliest, latest)

  return {
    date: v.date,
    symbol: v.symbol as NonNullable<typeof v.symbol>,
    contract_type: v.contract_type as NonNullable<typeof v.contract_type>,
    session,
    idea: v.idea,
    executions,
    stop_loss: v.stop_loss as number,
    drawdown: v.drawdown,
    buildup: v.buildup,
    rating: v.rating as NonNullable<typeof v.rating>,
    emotion: v.emotion as NonNullable<typeof v.emotion>,
    profit_target: v.profit_target as number,
    notes: v.notes,
    setup_tags: v.setup_tags,
    model_id: v.model_id,
    model_rules_followed: v.model_rules_followed,
  }
}

export function recordToForm(r: TradeRecord): TradeFormValues {
  const executions = [...r.executions]
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .map(e => ({
      kind: e.kind,
      order_type: e.order_type,
      price: e.price,
      // Stored ISO is `${date}T${HH:MM:SS}.000Z` — slice off the wallclock.
      time: e.time.slice(11, 19),
      contracts: e.contracts,
    }))

  return {
    date: r.date,
    symbol: r.symbol,
    contract_type: r.contract_type,
    idea: r.idea ?? '',
    executions,
    stop_loss: r.stop_loss,
    drawdown: r.drawdown,
    buildup: r.buildup,
    rating: r.rating,
    profit_target: r.profit_target,
    notes: r.notes ?? '',
    setup_tags: r.setup_tags ?? [],
    emotion: r.emotion,
    model_id: r.model_id ?? null,
    model_rules_followed: r.model_rules_followed ?? [],
  }
}

export function emptyForm(date: string): TradeFormValues {
  return {
    date,
    symbol: 'NQ',
    contract_type: 'micro',
    idea: '',
    executions: [
      { kind: 'buy', order_type: 'mkt', price: null, time: '', contracts: 1 },
      { kind: 'sell', order_type: 'mkt', price: null, time: '', contracts: 1 },
    ],
    stop_loss: null,
    drawdown: null,
    buildup: null,
    rating: 'poor',
    profit_target: null,
    notes: '',
    setup_tags: [],
    emotion: null,
    model_id: null,
    model_rules_followed: [],
  }
}
