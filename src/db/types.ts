// Runtime-authoritative enum values. Types are derived from these so adding
// a new session/symbol/etc. is a one-line change.
export const SYMBOLS = ['NQ', 'ES'] as const
export const CONTRACT_TYPES = ['micro', 'mini'] as const
export const SESSIONS = ['pre', 'am', 'lunch', 'pm', 'aft'] as const
export const RATINGS = ['good', 'excellent', 'poor'] as const
export const EXECUTION_KINDS = ['buy', 'sell'] as const
export const ORDER_TYPES = ['limit', 'market'] as const
export const SIDES = ['long', 'short'] as const

export type SymbolKey = (typeof SYMBOLS)[number]
export type ContractType = (typeof CONTRACT_TYPES)[number]
export type Session = (typeof SESSIONS)[number]
export type Rating = (typeof RATINGS)[number]
export type ExecutionKind = (typeof EXECUTION_KINDS)[number]
export type OrderType = (typeof ORDER_TYPES)[number]
export type Side = (typeof SIDES)[number]

export interface Execution {
  kind: ExecutionKind
  order_type?: OrderType // legacy rows may omit; defaults to 'limit' on read
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

// Optional journaling fields. All nullable / empty by default so existing
// trades work without migration. `emotion` is required on new trades but
// stays optional on the type so legacy rows still load.
export const EMOTIONS = [
  'calm',
  'focused',
  'anxious',
  'fearful',
  'FOMO',
  'impatient',
  'frustrated',
  'tired',
  'greedy',
  'busy',
] as const
export type Emotion = (typeof EMOTIONS)[number]

// Display fallback for trades with no model selected. Not a real Model
// row — never appears on the Models page; only used as a label wherever the
// model name would otherwise be blank.
export const DEFAULT_MODEL_NAME = 'gambling'

export interface TradeRecord {
  id: string
  account_id: string
  date: string // YYYY-MM-DD (local), set by day-click in calendar
  symbol: SymbolKey
  contract_type: ContractType
  session: Session
  idea: string
  executions: Execution[] // stored sorted by time ascending
  stop_loss: number // USD (positive number representing risk amount)
  drawdown: number | null // USD, MAE — max adverse excursion (optional)
  buildup: number | null // USD, MFE — max favorable excursion (optional)
  rating: Rating
  screenshot: string | null // ref string: 'drive:{fileId}' or 'pending:{pendingId}'
  // Journaling / model fields (all optional; empty/null on legacy rows).
  profit_target: number // USD planned profit target
  notes?: string // post-trade notes (markdown)
  setup_tags?: string[] // ["breakout", "trend-cont", ...]
  mistake_tags?: string[] // ["FOMO", "moved stop", ...]
  emotion?: Emotion | null
  model_id?: string | null
  model_rules_followed?: string[] // rule strings that were honoured
  created_at: string // ISO
  updated_at: string // ISO
}

export type TradeDraft = Omit<TradeRecord, 'id' | 'account_id' | 'created_at' | 'updated_at'>

export type AdjustmentKind = 'deposit' | 'withdraw' | 'fee'

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

// Per-day record (one row per account+date). Holds the day's free-text
// note, screenshot list, and structured to grow with future per-day fields.
// Id is derived as `${account_id}:${date}` so cross-device sync produces
// the same row naturally without the UI tracking a random UUID.
//
// `screenshots` is a multi-entry indexed array of Drive refs (`drive:...`
// or `pending:...`). The pending drainer looks up rows by `where('screenshots')
// .equals('pending:<id>')` to rewrite refs in place.
//
// `note` is the user's free-text journal entry for the day. Optional on the
// type so legacy rows (pre-v25) load cleanly; the UI treats `undefined` and
// `''` interchangeably.
export interface Day {
  id: string
  account_id: string
  date: string // YYYY-MM-DD
  screenshots: string[]
  note?: string
  created_at: string
  updated_at: string
}

// A named strategy / setup. `groups` holds rule groups (e.g. Entry, Exit,
// Risk Management) each with a list of rules. Rules are simple strings to
// keep the schema flexible; the UI surfaces them as a checklist on the
// trade form.
export interface ModelRuleGroup {
  id: string
  name: string
  rules: string[]
}
export interface Model {
  id: string
  account_id: string
  name: string
  description: string
  sessions: Session[] // sessions this model is meant for; empty = any
  groups: ModelRuleGroup[]
  archived: boolean
  created_at: string
  updated_at: string
}

// Daily routine rules ("review yesterday's trades", "no trading on red news",
// etc.). The user defines a rule list once; each day they tick boxes. The
// adherence score is just (checked / total) per day.
export interface ProgressRule {
  id: string
  account_id: string
  text: string
  active: boolean
  sort: number
  created_at: string
  updated_at: string
}
export interface ProgressCheck {
  id: string // `${account_id}:${date}:${rule_id}`
  account_id: string
  date: string // YYYY-MM-DD
  rule_id: string
  checked: boolean
  created_at: string
  updated_at: string
}

// Persisted USD high/medium-impact news drivers per NY calendar day.
// The table mirrors whatever the latest feed reports — events that
// disappear from a fresh fetch (postponed / cancelled) are deleted.
//
// Not scoped per account — economic news is global — so no `account_id`.
export type PersistedNewsImpact = 'High' | 'Medium'
export interface NewsEvent {
  id: string // `${date}${title}` (unit-separator avoids title collisions)
  date: string // YYYY-MM-DD (NY calendar)
  title: string
  country: string // always 'USD' for now
  impact: PersistedNewsImpact
  scheduled_at: string // ISO 8601 UTC, the event's actual clock time
  forecast: string
  previous: string
  created_at: string
  updated_at: string
}
