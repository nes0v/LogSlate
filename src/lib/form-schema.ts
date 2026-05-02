import { z } from 'zod'
import { format, parseISO } from 'date-fns'
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

// Auto-detect a trade's session from its first (earliest) execution. Times
// are interpreted as NY-local HH:MM since the user enters times in NY time.
// 17:00–17:59 (the daily settlement break) is folded into "aft" so any
// stray execution there still classifies cleanly.
export function detectSession(time: string): Session {
  const [h, m] = time.split(':').map(Number)
  const mins = h * 60 + m
  if (mins >= 9 * 60 + 30 && mins <= 11 * 60 + 29) return 'am'
  if (mins >= 11 * 60 + 30 && mins <= 13 * 60 + 29) return 'lunch'
  if (mins >= 13 * 60 + 30 && mins <= 16 * 60 + 59) return 'pm'
  if (mins >= 17 * 60) return 'aft'
  return 'pre'
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
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24h)'),
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
    screenshot: z.string().nullable(),
    // Journaling fields. The form supplies defaults so RHF resolves them;
    // downstream code treats them as optional / nullable.
    profit_target: requiredPositive('profit target must be > 0'),
    notes: z.string(),
    setup_tags: z.array(z.string()),
    mistake_tags: z.array(z.string()),
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

export type TradeFormValues = z.infer<typeof tradeFormSchema>

// Combine a local date (YYYY-MM-DD) and local time (HH:MM) into an ISO UTC string.
function toIso(date: string, time: string): string {
  // `new Date('YYYY-MM-DDTHH:MM')` is interpreted as local time by all major engines.
  const d = new Date(`${date}T${time}`)
  return d.toISOString()
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

  // Session is auto-detected from the earliest HH:MM (lexical sort works
  // since all executions share the same date).
  const earliest = v.executions.reduce((acc, e) => (e.time < acc ? e.time : acc), v.executions[0]!.time)
  const session = detectSession(earliest)

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
    screenshot: v.screenshot,
    profit_target: v.profit_target as number,
    notes: v.notes,
    setup_tags: v.setup_tags,
    mistake_tags: v.mistake_tags,
    emotion: v.emotion,
    model_id: v.model_id,
    model_rules_followed: v.model_rules_followed,
  }
}

export function recordToForm(r: TradeRecord): TradeFormValues {
  const executions = [...r.executions]
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .map(e => ({
      kind: e.kind,
      order_type: e.order_type ?? 'limit',
      price: e.price,
      time: format(parseISO(e.time), 'HH:mm'),
      contracts: e.contracts,
    }))

  return {
    date: r.date,
    symbol: r.symbol,
    contract_type: r.contract_type,
    idea: r.idea,
    executions,
    stop_loss: r.stop_loss,
    drawdown: r.drawdown,
    buildup: r.buildup,
    rating: r.rating,
    screenshot: r.screenshot,
    profit_target: r.profit_target ?? 0,
    notes: r.notes ?? '',
    setup_tags: r.setup_tags ?? [],
    mistake_tags: r.mistake_tags ?? [],
    emotion: r.emotion ?? null,
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
      { kind: 'buy', order_type: 'limit', price: null, time: '', contracts: 1 },
      { kind: 'sell', order_type: 'limit', price: null, time: '', contracts: 1 },
    ],
    stop_loss: null,
    drawdown: null,
    buildup: null,
    rating: 'poor',
    screenshot: null,
    profit_target: null,
    notes: '',
    setup_tags: [],
    mistake_tags: [],
    emotion: null,
    model_id: null,
    model_rules_followed: [],
  }
}
