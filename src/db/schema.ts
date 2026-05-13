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
} from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'

class LogslateDB extends Dexie {
  trades!: EntityTable<TradeRecord, 'id'>
  adjustments!: EntityTable<EquityAdjustment, 'id'>
  accounts!: EntityTable<Account, 'id'>
  pending_uploads!: EntityTable<PendingUpload, 'id'>
  days!: EntityTable<Day, 'id'>
  models!: EntityTable<Model, 'id'>
  progress_rules!: EntityTable<ProgressRule, 'id'>
  progress_checks!: EntityTable<ProgressCheck, 'id'>
  news!: EntityTable<NewsEvent, 'id'>

  constructor() {
    super('logslate')

    // Pre-release schema. Every prior version (v1–v26) was rolled into a
    // single fresh shape (v1 here); v2 added `[account_id+model_id]` for
    // the Models editor's "in use" check; v3 dropped a pile of indexes
    // that nothing actually queried — pure write amplification.
    //
    // Index policy: only fields that appear in `db.<table>.where(...)` /
    // `orderBy(...)` get an index. Standalone indexes covered by an
    // existing compound (e.g. `date` when `[account_id+date]` is here)
    // are redundant — Dexie can satisfy the unscoped query through the
    // compound's first key.
    //
    // Surviving indexes:
    //   - `&id` is the primary key (mandatory).
    //   - `[account_id+date]` — calendar/date-range queries scoped to one account.
    //   - `[account_id+model_id]` — powers `countTradesUsingModel`.
    //   - `account_id` — `deleteAccount` + `countAccountData` cascade scans.
    //   - `screenshot` — `cleanOrphanedPendingRefs` + the upload drainer.
    //   - `*screenshots` on `days` is multi-entry so the drainer locates
    //     rows by ref the same way it does for trades.
    //   - `news.date` — Day page looks up news by date.
    //   - `progress_rules.sort` — `sortBy('sort')` in the rule list.
    //   - `updated_at` everywhere is kept for sync ergonomics — sync
    //     currently calls `.toArray()` but indexed updated_at lets us
    //     migrate to incremental pulls without another schema bump.
    this.version(1).stores({
      trades:
        '&id, [account_id+date], account_id, date, symbol, session, screenshot, updated_at, created_at',
      adjustments:
        '&id, [account_id+date], account_id, date, updated_at, created_at',
      accounts: '&id, is_main, updated_at',
      pending_uploads: '&id, account_id, month_key, created_at',
      days:
        '&id, [account_id+date], account_id, date, *screenshots, updated_at',
      models:
        '&id, [account_id+archived], account_id, archived, updated_at, created_at',
      progress_rules:
        '&id, [account_id+active], account_id, active, sort, updated_at',
      progress_checks:
        '&id, [account_id+date], account_id, date, rule_id, updated_at',
      news: '&id, date, updated_at',
    })
    this.version(2).stores({
      trades:
        '&id, [account_id+date], [account_id+model_id], account_id, date, symbol, session, model_id, screenshot, updated_at, created_at',
    })
    this.version(3).stores({
      trades:
        '&id, [account_id+date], [account_id+model_id], account_id, screenshot, updated_at',
      adjustments: '&id, [account_id+date], account_id, updated_at',
      accounts: '&id, updated_at',
      pending_uploads: '&id, account_id',
      days: '&id, [account_id+date], account_id, *screenshots, updated_at',
      models: '&id, account_id, updated_at',
      progress_rules: '&id, account_id, sort, updated_at',
      progress_checks: '&id, [account_id+date], account_id, updated_at',
      news: '&id, date, updated_at',
    })
  }
}

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
    created_at: ts,
    updated_at: ts,
  })
}

// Clears trade / day-row references that point at pending uploads which no
// longer exist in the queue (e.g. blob lost in storage, queue cleared
// across an app reset). Without this, a stale `pending:foo` ref would show
// as "Pending upload missing" forever.
//
// Safe to call repeatedly; cheap when there's nothing to do.
export async function cleanOrphanedPendingRefs(): Promise<void> {
  const [staleTrades, staleDays, pending] = await Promise.all([
    db.trades.where('screenshot').startsWith('pending:').toArray(),
    db.days.where('screenshots').startsWith('pending:').toArray(),
    db.pending_uploads.toArray(),
  ])
  if (staleTrades.length === 0 && staleDays.length === 0) return
  const live = new Set(pending.map(p => p.id))
  const now = new Date().toISOString()
  await db.transaction('rw', db.trades, db.days, async () => {
    for (const t of staleTrades) {
      const pid = t.screenshot?.slice('pending:'.length)
      if (!pid || !live.has(pid)) {
        await db.trades.update(t.id, { screenshot: null, updated_at: now })
      }
    }
    for (const d of staleDays) {
      const filtered = d.screenshots.filter(ref => {
        if (!ref.startsWith('pending:')) return true
        return live.has(ref.slice('pending:'.length))
      })
      if (filtered.length === d.screenshots.length) continue
      // Only delete the row when there's truly nothing left to keep —
      // an empty screenshots list with no note. A day's note is a
      // user-authored journal entry and is independent of screenshots.
      if (filtered.length === 0 && !d.note) {
        await db.days.delete(d.id)
      } else {
        await db.days.update(d.id, { screenshots: filtered, updated_at: now })
      }
    }
  })
}
