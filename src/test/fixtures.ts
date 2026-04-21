import type {
  AdjustmentDraft,
  EquityAdjustment,
  Execution,
  TradeDraft,
  TradeRecord,
} from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'

let idSeq = 0
function nextId(): string {
  idSeq += 1
  return `test-id-${idSeq}`
}

export function execution(overrides: Partial<Execution> = {}): Execution {
  return {
    kind: 'buy',
    price: 20000,
    time: '2026-04-15T14:30:00.000Z',
    contracts: 1,
    ...overrides,
  }
}

export function tradeDraft(overrides: Partial<TradeDraft> = {}): TradeDraft {
  return {
    trade_date: '2026-04-15',
    symbol: 'NQ',
    contract_type: 'mini',
    session: 'AM',
    idea: 'test trade',
    executions: [
      execution({ kind: 'buy', price: 20000, time: '2026-04-15T14:30:00.000Z', contracts: 1 }),
      execution({ kind: 'sell', price: 20010, time: '2026-04-15T14:45:00.000Z', contracts: 1 }),
    ],
    stop_loss: 100,
    drawdown: 20,
    buildup: 200,
    planned_rr: 2,
    rating: 'good',
    pnl_override: null,
    screenshot: null,
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
