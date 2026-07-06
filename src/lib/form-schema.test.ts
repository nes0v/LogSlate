import { describe, expect, it } from 'vitest'
import { SESSIONS } from '@/db/types'
import {
  detectSession,
  emptyForm,
  formToDraft,
  recordToForm,
  tradeFormSchema,
  type TradeFormValues,
} from './form-schema'
import { symbolSnapshot, tradeRecord } from '@/test/fixtures'

function validForm(overrides: Partial<TradeFormValues> = {}): TradeFormValues {
  return {
    ...emptyForm('2026-04-15'),
    symbol_id: 'sym-nq',
    rating: 'good',
    stop_loss: 100,
    profit_target: 200,
    drawdown: 20,
    runup: 200,
    emotion: 'focused',
    executions: [
      { kind: 'buy', order_type: 'lmt', price: 20000, time: '10:00:00', contracts: 1 },
      { kind: 'sell', order_type: 'lmt', price: 20010, time: '10:05:00', contracts: 1 },
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
          { kind: 'buy', order_type: 'lmt', price: 20000, time: '10:00:00', contracts: 2 },
          { kind: 'sell', order_type: 'lmt', price: 20010, time: '10:05:00', contracts: 1 },
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
          { kind: 'buy', order_type: 'lmt', price: 20000, time: '10:00:00', contracts: 1 },
          { kind: 'buy', order_type: 'lmt', price: 20010, time: '10:05:00', contracts: 1 },
        ],
      }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects zero/negative price and invalid time', () => {
    const r = tradeFormSchema.safeParse(
      validForm({
        executions: [
          { kind: 'buy', order_type: 'lmt', price: 0, time: '25:00', contracts: 1 },
          { kind: 'sell', order_type: 'lmt', price: -5, time: 'noon', contracts: 1 },
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
          { kind: 'sell', order_type: 'lmt', price: 20010, time: '10:05:00', contracts: 1 },
          { kind: 'buy', order_type: 'lmt', price: 20000, time: '10:00:00', contracts: 1 },
        ],
      }),
      symbolSnapshot(),
    )
    expect(draft.executions[0].kind).toBe('buy')
    expect(draft.executions[1].kind).toBe('sell')
    expect(draft.executions[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('detectSession — bands (no promotion when close === open)', () => {
  // Boundaries are inclusive at the start and exclusive at the end of
  // each band; passing close === open means the promotion check fails
  // trivially so each call exercises only the band classifier.
  it('classifies pre-market times', () => {
    expect(detectSession('00:00', '00:00')).toBe('pre')
    expect(detectSession('09:29', '09:29')).toBe('pre')
  })
  it('classifies the morning band as am', () => {
    expect(detectSession('09:30', '09:30')).toBe('am')
    expect(detectSession('11:29', '11:29')).toBe('am')
  })
  it('classifies midday as lunch', () => {
    expect(detectSession('11:30', '11:30')).toBe('lunch')
    expect(detectSession('13:29', '13:29')).toBe('lunch')
  })
  it('classifies the afternoon band as pm', () => {
    expect(detectSession('13:30', '13:30')).toBe('pm')
    expect(detectSession('16:59', '16:59')).toBe('pm')
  })
  it('classifies evening times as aft', () => {
    expect(detectSession('17:00', '17:00')).toBe('aft')
    expect(detectSession('23:59', '23:59')).toBe('aft')
  })
})

describe('detectSession — next-session promotion', () => {
  it('promotes lunch → pm when open is in last 15 min and close is 30+ min past pm start', () => {
    expect(detectSession('13:18', '14:05')).toBe('pm')
  })

  it('keeps lunch when open is more than 15 min before the next session', () => {
    expect(detectSession('13:13', '14:30')).toBe('lunch')
  })

  it('keeps lunch when close is less than 30 min after pm start', () => {
    expect(detectSession('13:18', '13:55')).toBe('lunch')
  })

  it('promotes pre → am at the boundary (open 15 min before, close 30 min after)', () => {
    // open=09:14 → 9:29 - 9:14 = 15 min ≤ 15. close=10:00 → 10:00 - 9:30 = 30 min ≥ 30.
    expect(detectSession('09:14', '10:00')).toBe('am')
  })

  it('does not promote at 16-min-before / 30-min-after (open just outside the grace window)', () => {
    expect(detectSession('09:13', '10:00')).toBe('pre')
  })

  it('does not promote at 15-min-before / 29-min-after (close just inside)', () => {
    expect(detectSession('09:14', '09:59')).toBe('pre')
  })

  it('promotes one step only — open 09:25 / close 14:00 lands in am, not lunch or pm', () => {
    expect(detectSession('09:25', '14:00')).toBe('am')
  })

  it('promotes am → lunch when conditions hold', () => {
    expect(detectSession('11:25', '12:05')).toBe('lunch')
  })

  it('promotes pm → aft when conditions hold', () => {
    expect(detectSession('16:50', '17:35')).toBe('aft')
  })

  it('aft never promotes (last band, no next)', () => {
    expect(detectSession('17:05', '23:55')).toBe('aft')
  })

  it('zero-duration trade (close === open) keeps the open session even at the tail', () => {
    expect(detectSession('13:25', '13:25')).toBe('lunch')
  })

  it('truncates seconds — 09:30:45 classifies as am, not pre', () => {
    expect(detectSession('09:30:45', '09:30:45')).toBe('am')
  })

  it('every Session in the union is reachable (drift-guard if a new band is added)', () => {
    const reached = new Set([
      detectSession('06:00', '06:00'),
      detectSession('10:00', '10:00'),
      detectSession('12:00', '12:00'),
      detectSession('14:30', '14:30'),
      detectSession('20:00', '20:00'),
    ])
    for (const s of SESSIONS) expect(reached.has(s)).toBe(true)
  })
})

describe('recordToForm ↔ formToDraft round-trip', () => {
  it('preserves key fields', () => {
    const record = tradeRecord({
      date: '2026-04-15',
      symbol_id: 'sym-nq',
      symbol_spec: symbolSnapshot(),
      stop_loss: 100,
      profit_target: 200,
      drawdown: 20,
      runup: 200,
      rating: 'good',
    })
    const roundTrip = formToDraft(recordToForm(record), record.symbol_spec)
    expect(roundTrip.symbol_id).toBe(record.symbol_id)
    expect(roundTrip.symbol_spec).toEqual(record.symbol_spec)
    // session is now derived from executions on save; session round-trips via
    // execution times rather than as a stored field on the form.
    expect(roundTrip.stop_loss).toBe(record.stop_loss)
    expect(roundTrip.executions).toHaveLength(record.executions.length)
  })

  it('defaults missing optional text fields to empty strings on the form', () => {
    // `idea` and `notes` are optional on the record (TradeRecord.idea?:
    // string, TradeRecord.notes?: string). The form's textarea always
    // needs a string buffer, so the read path must paper over `undefined`.
    const record = tradeRecord({ idea: undefined, notes: undefined })
    const form = recordToForm(record)
    expect(form.idea).toBe('')
    expect(form.notes).toBe('')
  })
})
