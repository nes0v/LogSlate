export type SymbolKey = 'NQ' | 'ES'
export type ContractType = 'micro' | 'mini'
export type Session = 'pre' | 'AM' | 'LT' | 'PM' | 'aft'
export type Rating = 'good' | 'excellent' | 'meh'
export type PlannedRR = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type Side = 'long' | 'short'

export type ExecutionKind = 'buy' | 'sell'

export interface Execution {
  kind: ExecutionKind
  price: number
  time: string // ISO 8601
  contracts: number
}

export interface Account {
  id: string
  name: string
  is_main: boolean
  created_at: string
  updated_at: string
}

// The Main account uses a fixed id so it stays identical across devices on sync.
export const MAIN_ACCOUNT_ID = 'main'

export type AccountDraft = Pick<Account, 'name'>

export interface TradeRecord {
  id: string
  account_id: string
  trade_date: string // YYYY-MM-DD (local), set by day-click in calendar
  symbol: SymbolKey
  contract_type: ContractType
  session: Session
  idea: string
  executions: Execution[] // stored sorted by time ascending
  stop_loss: number // USD (positive number representing risk amount)
  drawdown: number // USD, MAE — max adverse excursion
  buildup: number | null // USD, MFE — max favorable excursion (optional)
  planned_rr: PlannedRR
  rating: Rating
  pnl_override: number | null // when set, overrides computed net PnL
  screenshot: string | null // base64 data URL
  created_at: string // ISO
  updated_at: string // ISO
}

export type TradeDraft = Omit<TradeRecord, 'id' | 'account_id' | 'created_at' | 'updated_at'>

export type AdjustmentKind = 'deposit' | 'withdraw'

export interface EquityAdjustment {
  id: string
  account_id: string
  date: string // YYYY-MM-DD (local)
  kind: AdjustmentKind
  amount: number // positive USD; the kind determines sign at the math layer
  note: string
  created_at: string // ISO
  updated_at: string // ISO
}

export type AdjustmentDraft = Omit<EquityAdjustment, 'id' | 'account_id' | 'created_at' | 'updated_at'>
