import { z } from 'zod'
import { format, parseISO } from 'date-fns'
import type { TradeDraft, TradeRecord } from '@/db/types'

const executionSchema = z.object({
  kind: z.enum(['buy', 'sell']),
  price: z.number().positive('price must be > 0'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24h)'),
  contracts: z.number().int().positive('contracts must be a positive integer'),
})

export const tradeFormSchema = z
  .object({
    trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid date'),
    symbol: z.enum(['NQ', 'ES']),
    contract_type: z.enum(['micro', 'mini']),
    session: z.enum(['pre', 'AM', 'LT', 'PM', 'aft']),
    idea: z.string(),
    executions: z.array(executionSchema).min(2, 'at least one buy and one sell'),
    stop_loss: z.number().positive('stop loss must be > 0'),
    drawdown: z.number().min(0, 'must be ≥ 0'),
    buildup: z.number().min(0, 'must be ≥ 0').nullable(),
    planned_rr: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]),
    rating: z.enum(['good', 'excellent', 'egg']),
    pnl_override: z.number().nullable(),
    screenshot: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
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
  const executions = v.executions
    .map(e => ({
      kind: e.kind,
      price: e.price,
      time: toIso(v.trade_date, e.time),
      contracts: e.contracts,
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))

  return {
    trade_date: v.trade_date,
    symbol: v.symbol,
    contract_type: v.contract_type,
    session: v.session,
    idea: v.idea,
    executions,
    stop_loss: v.stop_loss,
    drawdown: v.drawdown,
    buildup: v.buildup,
    planned_rr: v.planned_rr,
    rating: v.rating,
    pnl_override: v.pnl_override,
    screenshot: v.screenshot,
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
    planned_rr: r.planned_rr,
    rating: r.rating,
    pnl_override: r.pnl_override,
    screenshot: r.screenshot,
  }
}

export function emptyForm(trade_date: string): TradeFormValues {
  return {
    trade_date,
    symbol: 'NQ',
    contract_type: 'micro',
    session: 'AM',
    idea: '',
    executions: [
      { kind: 'buy', price: 0, time: '', contracts: 1 },
      { kind: 'sell', price: 0, time: '', contracts: 1 },
    ],
    stop_loss: 0,
    drawdown: 0,
    buildup: null,
    planned_rr: 2,
    rating: 'good',
    pnl_override: null,
    screenshot: null,
  }
}
