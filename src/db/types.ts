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

// Optional reflection / journaling fields. All nullable / empty by default
// so existing trades work without migration. The form surfaces these in a
// collapsible "Reflection" panel.
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

// Display fallback for trades with no playbook selected. Not a real Playbook
// row — never appears on the Models page; only used as a label wherever the
// model name would otherwise be blank.
export const DEFAULT_MODEL_NAME = 'gambling'

export const MARKET_CONDITIONS = [
  'trending',
  'ranging',
  'choppy',
  'volatile',
  'thin',
  'news-driven',
] as const
export type MarketCondition = (typeof MARKET_CONDITIONS)[number]

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
  drawdown: number | null // USD, MAE — max adverse excursion (optional)
  buildup: number | null // USD, MFE — max favorable excursion (optional)
  rating: Rating
  screenshot: string | null // base64 data URL
  // Reflection / playbook fields (all optional; empty/null on legacy rows).
  profit_target: number // USD planned profit target
  notes?: string // post-trade notes (markdown)
  setup_tags?: string[] // ["breakout", "trend-cont", ...]
  mistake_tags?: string[] // ["FOMO", "moved stop", ...]
  emotion?: Emotion | null
  market_condition?: MarketCondition | null
  conviction?: number | null // 1..5 (how strong was the conviction at entry?)
  playbook_id?: string | null
  playbook_rules_followed?: string[] // rule strings that were honoured
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

// Free-form note in the trader's notebook. Folders are just a free-text
// `folder` field — empty string means "root". Templates are stored verbatim
// in `body`; `template_kind` is a tag for filtering / re-applying.
export const NOTE_TEMPLATES = ['plan', 'watchlist', 'review', 'lesson', 'free'] as const
export type NoteTemplateKind = (typeof NOTE_TEMPLATES)[number]
export interface Note {
  id: string
  account_id: string
  folder: string // free text, '' means root
  title: string
  body: string // markdown
  template_kind: NoteTemplateKind
  pinned: boolean
  created_at: string
  updated_at: string
}

// A named strategy / setup. `groups` holds rule groups (e.g. Entry, Exit,
// Risk Management) each with a list of rules. Rules are simple strings to
// keep the schema flexible; the UI surfaces them as a checklist on the
// trade form.
export interface PlaybookRuleGroup {
  id: string
  name: string
  rules: string[]
}
export interface Playbook {
  id: string
  account_id: string
  name: string
  description: string
  symbols: SymbolKey[] // optional symbol filter ("works for NQ only", etc.)
  groups: PlaybookRuleGroup[]
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
