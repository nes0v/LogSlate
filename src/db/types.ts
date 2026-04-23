// Runtime-authoritative enum values. Types are derived from these so adding
// a new session/symbol/etc. is a one-line change.
export const SYMBOLS = ['NQ', 'ES'] as const
export const CONTRACT_TYPES = ['micro', 'mini'] as const
export const SESSIONS = ['pre', 'AM', 'LT', 'PM', 'aft'] as const
export const RATINGS = ['good', 'excellent', 'egg'] as const
export const EXECUTION_KINDS = ['buy', 'sell'] as const
export const SIDES = ['long', 'short'] as const

export type SymbolKey = (typeof SYMBOLS)[number]
export type ContractType = (typeof CONTRACT_TYPES)[number]
export type Session = (typeof SESSIONS)[number]
export type Rating = (typeof RATINGS)[number]
export type ExecutionKind = (typeof EXECUTION_KINDS)[number]
export type Side = (typeof SIDES)[number]
export type PlannedRR = 1 | 2 | 3 | 4 | 5 | 6 | 7

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

// Screenshots are uploaded to Drive. When the user picks an image while
// offline, the blob is stashed in this table; a drainer (wired into
// auto-sync) uploads it once the app is online and rewrites the trade's
// screenshot field to the Drive file id.
//
// `filename` and `month_key` are computed at enqueue time so the drainer
// can upload into the right YYYY-MM subfolder with a human-readable name
// without re-deriving context from the trade record (which might have
// changed between enqueue and drain).
export interface PendingUpload {
  id: string
  account_id: string
  blob: Blob
  filename: string
  month_key: string
  created_at: string
}

// Per-day screenshot (one per account+date). The user attaches an image to
// a trading day itself (e.g. a summary chart), independent of any individual
// trade. Id is derived as `${account_id}:${date}` so the record stays in
// lockstep across devices on sync without the UI needing to remember a
// random UUID.
export interface DayScreenshot {
  id: string
  account_id: string
  date: string // YYYY-MM-DD
  screenshot: string | null
  created_at: string
  updated_at: string
}
