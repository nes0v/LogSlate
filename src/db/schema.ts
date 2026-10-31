import Dexie, { type EntityTable } from 'dexie'
import type {
  Account,
  Day,
  EquityAdjustment,
  Model,
  NewsEvent,
  PendingUpload,
  ProgressCheck,
  ProgressRule,
  TradeRecord,
  TradingSymbol,
} from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'

class LogslateDB extends Dexie {
  trades!: EntityTable<TradeRecord, 'id'>
  adjustments!: EntityTable<EquityAdjustment, 'id'>
  accounts!: EntityTable<Account, 'id'>
  pending_uploads!: EntityTable<PendingUpload, 'id'>
  days!: EntityTable<Day, 'id'>
  models!: EntityTable<Model, 'id'>
  symbols!: EntityTable<TradingSymbol, 'id'>
  progress_rules!: EntityTable<ProgressRule, 'id'>
  progress_checks!: EntityTable<ProgressCheck, 'id'>
  news!: EntityTable<NewsEvent, 'id'>

  constructor() {
    super('logslate')

    // The version number only has to stay at or above the one the device's
    // IndexedDB already holds; Dexie refuses to open a database declared
    // lower than it is stored. Dexie adds and drops indexes itself when the
    // declared ones change.
    //
    // Index policy: only fields that appear in `db.<table>.where(...)` get an
    // index. A field that leads a compound index needs none of its own —
    // Dexie answers `where('account_id')` through `[account_id+date]`.
    //
    // Indexes:
    //   - `&id` is the primary key (mandatory).
    //   - `[account_id+date]` — trade and adjustment date-range queries.
    //   - `[account_id+model_id]` — powers `countTradesUsingModel`.
    //   - `[account_id+symbol_id]` — powers `countTradesUsingSymbol`.
    //   - `account_id` — per-account lists and the `deleteAccount` /
    //     `countAccountData` cascade scans on tables without an
    //     `[account_id+…]` compound.
    //   - `*screenshots` on `days` is multi-entry so the drainer locates
    //     day rows by ref.
    //   - `news.date` — Day page looks up news by date.
    this.version(22).stores({
      trades: '&id, [account_id+date], [account_id+model_id], [account_id+symbol_id]',
      adjustments: '&id, [account_id+date]',
      accounts: '&id',
      pending_uploads: '&id, account_id',
      days: '&id, account_id, *screenshots',
      models: '&id, account_id',
      symbols: '&id, account_id',
      progress_rules: '&id, account_id',
      progress_checks: '&id, account_id',
      news: '&id, date',
    })
    // Runs only when the database is created from nothing: first install, or
    // IndexedDB wiped while localStorage survived. Sync reads this to tell a
    // wipe apart from the user deleting everything (see `syncNow`).
    this.on('populate', () => {
      try {
        localStorage.setItem(FRESH_DB_KEY, '1')
      } catch {
        // Without storage there's no sync ledger to misread either.
      }
    })
  }
}

/** Set when the database was just created; cleared by the next sync. */
export const FRESH_DB_KEY = 'logslate:sync:fresh_db'

export const db = new LogslateDB()

// Seeds a default 'main' account on a truly fresh DB so the app always has
// somewhere to land. Once any account exists this is a no-op — including
// after the user has deleted main themselves (we don't resurrect it).
export async function ensureMainAccount(): Promise<void> {
  const total = await db.accounts.count()
  if (total > 0) return
  const ts = new Date().toISOString()
  await db.accounts.put({
    id: MAIN_ACCOUNT_ID,
    name: 'main',
    is_main: true,
    starting_balance: 0,
    created_at: ts,
    updated_at: ts,
  })
}

// True when a day row carries something worth keeping. Used by every
// empty-row garbage collector so a day that holds ONLY a PNL override
// (no note, no screenshots) is never dropped.
export function dayHasContent(
  day: Pick<
    Day,
    | 'screenshots'
    | 'note'
    | 'pnl_override'
  >,
): boolean {
  return (
    day.screenshots.length > 0 ||
    !!day.note ||
    typeof day.pnl_override === 'number'
  )
}

// Clears day-row references that point at pending uploads which no
// longer exist in the queue (e.g. blob lost in storage, queue cleared
// across an app reset). Without this, a stale `pending:foo` ref would show
// as "Pending upload missing" forever.
//
// Safe to call repeatedly; cheap when there's nothing to do.
export async function cleanOrphanedPendingRefs(): Promise<void> {
  const [staleDays, pending] = await Promise.all([
    db.days.where('screenshots').startsWith('pending:').toArray(),
    db.pending_uploads.toArray(),
  ])
  if (staleDays.length === 0) return
  const live = new Set(pending.map(p => p.id))
  const now = new Date().toISOString()
  await db.transaction('rw', db.days, async () => {
    for (const d of staleDays) {
      const filtered = d.screenshots.filter(ref => {
        if (!ref.startsWith('pending:')) return true
        return live.has(ref.slice('pending:'.length))
      })
      if (filtered.length === d.screenshots.length) continue
      // Only delete the row when there's truly nothing left to keep. A day's
      // note/override are user-authored and independent of screenshots, so
      // defer to the shared keep-rule with the filtered list applied.
      if (!dayHasContent({ ...d, screenshots: filtered })) {
        await db.days.delete(d.id)
      } else {
        await db.days.update(d.id, { screenshots: filtered, updated_at: now })
      }
    }
  })
}
