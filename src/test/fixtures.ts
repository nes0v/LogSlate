import type {
  AdjustmentDraft,
  EquityAdjustment,
  Execution,
  SymbolSnapshot,
  TradeDraft,
  TradeRecord,
  TradingSymbol,
} from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'

let idSeq = 0
function nextId(): string {
  idSeq += 1
  return `test-id-${idSeq}`
}

// Default frozen economics = NQ mini (point $20, fee $2.25/side, scratch 4pts).
export function symbolSnapshot(overrides: Partial<SymbolSnapshot> = {}): SymbolSnapshot {
  return {
    name: 'NQ',
    point_value: 20,
    tick_size: 0.25,
    fee_per_side: 2.25,
    scratch_handles: 4,
    ...overrides,
  }
}

export function tradingSymbol(overrides: Partial<TradingSymbol> = {}): TradingSymbol {
  const now = '2026-04-15T15:00:00.000Z'
  return {
    id: overrides.id ?? nextId(),
    account_id: overrides.account_id ?? MAIN_ACCOUNT_ID,
    name: 'NQ',
    description: '',
    point_value: 20,
    tick_size: 0.25,
    fee_per_side: 2.25,
    scratch_handles: 4,
    draft: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

export function execution(overrides: Partial<Execution> = {}): Execution {
  return {
    kind: 'buy',
    order_type: 'lmt',
    price: 20000,
    time: '2026-04-15T14:30:00.000Z',
    contracts: 1,
    ...overrides,
  }
}

export function tradeDraft(overrides: Partial<TradeDraft> = {}): TradeDraft {
  return {
    date: '2026-04-15',
    symbol_id: 'sym-nq',
    symbol_spec: symbolSnapshot(),
    session: 'am',
    notes: 'test trade',
    executions: [
      execution({ kind: 'buy', price: 20000, time: '2026-04-15T14:30:00.000Z', contracts: 1 }),
      execution({ kind: 'sell', price: 20010, time: '2026-04-15T14:45:00.000Z', contracts: 1 }),
    ],
    stop_loss: 100,
    profit_target: 200,
    drawdown: 20,
    runup: 200,
    rating: 'good',
    emotion: 'calm',
    ...overrides,
  }
}

export function tradeRecord(overrides: Partial<TradeRecord> = {}): TradeRecord {
  const now = '2026-04-15T15:00:00.000Z'
  const draft = tradeDraft(overrides as Partial<TradeDraft>)
  return {
    ...draft,
    id: overrides.id ?? nextId(),
    account_id: overrides.account_id ?? MAIN_ACCOUNT_ID,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  }
}

export function adjustmentDraft(overrides: Partial<AdjustmentDraft> = {}): AdjustmentDraft {
  return {
    date: '2026-04-01',
    kind: 'deposit',
    amount: 1000,
    note: '',
    ...overrides,
  }
}

export function adjustmentRecord(overrides: Partial<EquityAdjustment> = {}): EquityAdjustment {
  const now = '2026-04-01T00:00:00.000Z'
  const draft = adjustmentDraft(overrides as Partial<AdjustmentDraft>)
  return {
    ...draft,
    id: overrides.id ?? nextId(),
    account_id: overrides.account_id ?? MAIN_ACCOUNT_ID,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  }
}
