import { z } from 'zod'
import { format, parseISO } from 'date-fns'
import {
  CONTRACT_TYPES,
  EMOTIONS,
  EXECUTION_KINDS,
  MARKET_CONDITIONS,
  RATINGS,
  SESSIONS,
  SYMBOLS,
  type TradeDraft,
  type TradeRecord,
} from '@/db/types'

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
  price: requiredPositive('price must be > 0'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24h)'),
  contracts: requiredPositiveInt('contracts must be a positive integer'),
})

export const tradeFormSchema = z
  .object({
    trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid date'),
    // Symbol/contract/session/rating start blank on new trades so the user
    // makes an explicit choice rather than silently submitting a default.
    // Required on submit via the superRefine below.
    symbol: z.enum(SYMBOLS).nullable(),
    contract_type: z.enum(CONTRACT_TYPES).nullable(),
    session: z.enum(SESSIONS).nullable(),
    idea: z.string(),
    executions: z.array(executionSchema).min(2, 'at least one buy and one sell'),
    stop_loss: requiredPositive('stop loss must be > 0'),
    drawdown: z.number().min(0, 'must be ≥ 0').nullable(),
    buildup: z.number().min(0, 'must be ≥ 0').nullable(),
    rating: z.enum(RATINGS).nullable(),
    screenshot: z.string().nullable(),
    // Optional reflection fields. The form supplies defaults so RHF resolves
    // them; downstream code treats them as optional / nullable.
    profit_target: requiredPositive('profit target must be > 0'),
    notes: z.string(),
    setup_tags: z.array(z.string()),
    mistake_tags: z.array(z.string()),
    emotion: z.enum(EMOTIONS).nullable(),
    market_condition: z.enum(MARKET_CONDITIONS).nullable(),
    conviction: z.number().int().min(1).max(5).nullable(),
    playbook_id: z.string().nullable(),
    playbook_rules_followed: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if (!v.symbol) {
      ctx.addIssue({ code: 'custom', path: ['symbol'], message: 'pick a symbol' })
    }
    if (!v.contract_type) {
      ctx.addIssue({ code: 'custom', path: ['contract_type'], message: 'pick a contract' })
    }
    if (!v.session) {
      ctx.addIssue({ code: 'custom', path: ['session'], message: 'pick a session' })
    }
    if (!v.rating) {
      ctx.addIssue({ code: 'custom', path: ['rating'], message: 'pick a rating' })
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

// Variant used on the new-trade page: emotion is required up-front so the
// reflection data isn't silently skipped. Edits keep the looser schema —
// pre-existing trades may have been created before this rule and shouldn't
// suddenly fail to save just by being opened.
export const newTradeFormSchema = tradeFormSchema.superRefine((v, ctx) => {
  if (!v.emotion) {
    ctx.addIssue({ code: 'custom', path: ['emotion'], message: 'pick an emotion' })
  }
})

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
      price: e.price as number,
      time: toIso(v.trade_date, e.time),
      contracts: e.contracts as number,
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))

  return {
    trade_date: v.trade_date,
    symbol: v.symbol as NonNullable<typeof v.symbol>,
    contract_type: v.contract_type as NonNullable<typeof v.contract_type>,
    session: v.session as NonNullable<typeof v.session>,
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
    market_condition: v.market_condition,
    conviction: v.conviction,
    playbook_id: v.playbook_id,
    playbook_rules_followed: v.playbook_rules_followed,
  }
}

export function recordToForm(r: TradeRecord): TradeFormValues {
  const executions = [...r.executions]
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .map(e => ({
      kind: e.kind,
      price: e.price,
      time: format(parseISO(e.time), 'HH:mm'),
      contracts: e.contracts,
    }))

  return {
    trade_date: r.trade_date,
    symbol: r.symbol,
    contract_type: r.contract_type,
    session: r.session,
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
    market_condition: r.market_condition ?? null,
    conviction: r.conviction ?? null,
    playbook_id: r.playbook_id ?? null,
    playbook_rules_followed: r.playbook_rules_followed ?? [],
  }
}

export function emptyForm(trade_date: string): TradeFormValues {
  return {
    trade_date,
    symbol: null,
    contract_type: null,
    session: null,
    idea: '',
    executions: [
      { kind: 'buy', price: null, time: '', contracts: 1 },
      { kind: 'sell', price: null, time: '', contracts: 1 },
    ],
    stop_loss: null,
    drawdown: null,
    buildup: null,
    rating: null,
    screenshot: null,
    profit_target: null,
    notes: '',
    setup_tags: [],
    mistake_tags: [],
    emotion: null,
    market_condition: null,
    conviction: null,
    playbook_id: null,
    playbook_rules_followed: [],
  }
}
