import { describe, expect, it } from 'vitest'
import {
  detectSession,
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
    symbol: 'NQ',
    contract_type: 'micro',
    session: 'am',
    rating: 'good',
    stop_loss: 100,
    profit_target: 200,
    drawdown: 20,
    buildup: 200,
    emotion: 'focused',
    executions: [
      { kind: 'buy', order_type: 'limit', price: 20000, time: '10:00:00', contracts: 1 },
      { kind: 'sell', order_type: 'limit', price: 20010, time: '10:05:00', contracts: 1 },
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
          { kind: 'buy', order_type: 'limit', price: 20000, time: '10:00:00', contracts: 2 },
          { kind: 'sell', order_type: 'limit', price: 20010, time: '10:05:00', contracts: 1 },
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
          { kind: 'buy', order_type: 'limit', price: 20000, time: '10:00:00', contracts: 1 },
          { kind: 'buy', order_type: 'limit', price: 20010, time: '10:05:00', contracts: 1 },
        ],
      }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects zero/negative price and invalid time', () => {
    const r = tradeFormSchema.safeParse(
      validForm({
        executions: [
          { kind: 'buy', order_type: 'limit', price: 0, time: '25:00', contracts: 1 },
          { kind: 'sell', order_type: 'limit', price: -5, time: 'noon', contracts: 1 },
        ],
      }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects stop_loss ≤ 0', () => {
    expect(tradeFormSchema.safeParse(validForm({ stop_loss: 0 })).success).toBe(false)
    expect(tradeFormSchema.safeParse(validForm({ stop_loss: -1 })).success).toBe(false)
  })

  it('rejects null emotion', () => {
    const r = tradeFormSchema.safeParse(validForm({ emotion: null }))
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues.find(i => i.path[0] === 'emotion')
      expect(issue?.message).toMatch(/emotion/i)
    }
  })
})

describe('formToDraft', () => {
  it('converts HH:mm:ss times to ISO and sorts executions by time', () => {
    const draft = formToDraft(
      validForm({
        executions: [
          { kind: 'sell', order_type: 'limit', price: 20010, time: '10:05:00', contracts: 1 },
          { kind: 'buy', order_type: 'limit', price: 20000, time: '10:00:00', contracts: 1 },
        ],
      }),
    )
    expect(draft.executions[0].kind).toBe('buy')
    expect(draft.executions[1].kind).toBe('sell')
    expect(draft.executions[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('detectSession', () => {
  // Returns lowercase enum values after the AM/LT/PM rename. Boundaries
  // are inclusive at the start and end of each band per the source.
  it('classifies pre-market times', () => {
    expect(detectSession('00:00')).toBe('pre')
    expect(detectSession('09:29')).toBe('pre')
  })
  it('classifies the morning band as am', () => {
    expect(detectSession('09:30')).toBe('am')
    expect(detectSession('11:29')).toBe('am')
  })
  it('classifies midday as lunch', () => {
    expect(detectSession('11:30')).toBe('lunch')
    expect(detectSession('13:29')).toBe('lunch')
  })
  it('classifies the afternoon band as pm', () => {
    expect(detectSession('13:30')).toBe('pm')
    expect(detectSession('16:59')).toBe('pm')
  })
  it('classifies evening times as aft', () => {
    expect(detectSession('17:00')).toBe('aft')
    expect(detectSession('23:59')).toBe('aft')
  })
})

describe('recordToForm ↔ formToDraft round-trip', () => {
  it('preserves key fields', () => {
    const record = tradeRecord({
      date: '2026-04-15',
      symbol: 'NQ',
      contract_type: 'mini',
      stop_loss: 100,
      profit_target: 200,
      drawdown: 20,
      buildup: 200,
      rating: 'good',
    })
    const roundTrip = formToDraft(recordToForm(record))
    expect(roundTrip.symbol).toBe(record.symbol)
    expect(roundTrip.contract_type).toBe(record.contract_type)
    // session is now derived from executions on save; session round-trips via
    // execution times rather than as a stored field on the form.
    expect(roundTrip.stop_loss).toBe(record.stop_loss)
    expect(roundTrip.executions).toHaveLength(record.executions.length)
  })
})
