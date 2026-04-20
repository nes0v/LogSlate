import { describe, expect, it } from 'vitest'
import {
  emptyForm,
  formToDraft,
  recordToForm,
  tradeFormSchema,
  type TradeFormValues,
} from './form-schema'
import { tradeRecord } from '@/test/fixtures'

function validForm(overrides: Partial<TradeFormValues> = {}): TradeFormValues {
  return {
    ...emptyForm('2026-04-15'),
    stop_loss: 100,
    drawdown: 20,
    buildup: 200,
    executions: [
      { kind: 'buy', price: 20000, time: '10:00', contracts: 1 },
      { kind: 'sell', price: 20010, time: '10:05', contracts: 1 },
    ],
    ...overrides,
  }
}

describe('tradeFormSchema', () => {
  it('accepts a well-formed trade', () => {
    const r = tradeFormSchema.safeParse(validForm())
    expect(r.success).toBe(true)
  })

  it('rejects when buy/sell contract totals mismatch', () => {
    const r = tradeFormSchema.safeParse(
      validForm({
        executions: [
          { kind: 'buy', price: 20000, time: '10:00', contracts: 2 },
          { kind: 'sell', price: 20010, time: '10:05', contracts: 1 },
        ],
      }),
    )
    expect(r.success).toBe(false)
    if (!r.success) {
      const messages = r.error.issues.map(i => i.message)
      expect(messages.some(m => /must equal/.test(m))).toBe(true)
    }
  })

  it('rejects when only one side is present', () => {
    const r = tradeFormSchema.safeParse(
      validForm({
        executions: [
          { kind: 'buy', price: 20000, time: '10:00', contracts: 1 },
          { kind: 'buy', price: 20010, time: '10:05', contracts: 1 },
        ],
      }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects zero/negative price and invalid time', () => {
    const r = tradeFormSchema.safeParse(
      validForm({
        executions: [
          { kind: 'buy', price: 0, time: '25:00', contracts: 1 },
          { kind: 'sell', price: -5, time: 'noon', contracts: 1 },
        ],
      }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects stop_loss ≤ 0', () => {
    expect(tradeFormSchema.safeParse(validForm({ stop_loss: 0 })).success).toBe(false)
    expect(tradeFormSchema.safeParse(validForm({ stop_loss: -1 })).success).toBe(false)
  })
})

describe('formToDraft', () => {
  it('converts HH:mm times to ISO and sorts executions by time', () => {
    const draft = formToDraft(
      validForm({
        executions: [
          { kind: 'sell', price: 20010, time: '10:05', contracts: 1 },
          { kind: 'buy', price: 20000, time: '10:00', contracts: 1 },
        ],
      }),
    )
    expect(draft.executions[0].kind).toBe('buy')
    expect(draft.executions[1].kind).toBe('sell')
    expect(draft.executions[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('recordToForm ↔ formToDraft round-trip', () => {
  it('preserves key fields', () => {
    const record = tradeRecord({
      trade_date: '2026-04-15',
      symbol: 'NQ',
      contract_type: 'mini',
      session: 'AM',
      stop_loss: 100,
      drawdown: 20,
      buildup: 200,
      planned_rr: 2,
      rating: 'good',
    })
    const roundTrip = formToDraft(recordToForm(record))
    expect(roundTrip.symbol).toBe(record.symbol)
    expect(roundTrip.contract_type).toBe(record.contract_type)
    expect(roundTrip.session).toBe(record.session)
    expect(roundTrip.stop_loss).toBe(record.stop_loss)
    expect(roundTrip.executions).toHaveLength(record.executions.length)
  })
})
