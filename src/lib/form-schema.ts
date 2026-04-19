import { z } from 'zod'
import type { TradeDraft } from '@/db/types'

const executionSchema = z.object({
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
    buys: z.array(executionSchema).min(1, 'at least one buy'),
    sells: z.array(executionSchema).min(1, 'at least one sell'),
    stop_loss: z.number().positive('stop loss must be > 0'),
    drawdown: z.number().min(0, 'must be ≥ 0'),
    buildup: z.number().min(0, 'must be ≥ 0'),
    planned_rr: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]),
    rating: z.enum(['good', 'excellent', 'meh']),
    pnl_override: z.number().nullable(),
    screenshot: z.string().nullable(),
  })

export type TradeFormValues = z.infer<typeof tradeFormSchema>

// Combine a local date (YYYY-MM-DD) and local time (HH:MM) into an ISO UTC string.
function toIso(date: string, time: string): string {
  // `new Date('YYYY-MM-DDTHH:MM')` is interpreted as local time by all major engines.
  const d = new Date(`${date}T${time}`)
  return d.toISOString()
}

export function formToDraft(v: TradeFormValues): TradeDraft {
  return {
    trade_date: v.trade_date,
    symbol: v.symbol,
    contract_type: v.contract_type,
    session: v.session,
    idea: v.idea,
    buys: v.buys.map(b => ({ price: b.price, time: toIso(v.trade_date, b.time), contracts: b.contracts })),
    sells: v.sells.map(s => ({ price: s.price, time: toIso(v.trade_date, s.time), contracts: s.contracts })),
    stop_loss: v.stop_loss,
    drawdown: v.drawdown,
    buildup: v.buildup,
    planned_rr: v.planned_rr,
    rating: v.rating,
    pnl_override: v.pnl_override,
    screenshot: v.screenshot,
  }
}

export function emptyForm(trade_date: string): TradeFormValues {
  return {
    trade_date,
    symbol: 'NQ',
    contract_type: 'micro',
    session: 'AM',
    idea: '',
    buys: [{ price: 0, time: '', contracts: 1 }],
    sells: [{ price: 0, time: '', contracts: 1 }],
    stop_loss: 0,
    drawdown: 0,
    buildup: 0,
    planned_rr: 2,
    rating: 'good',
    pnl_override: null,
    screenshot: null,
  }
}
