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

    // Pre-release schema. All prior shapes (v1–v8 in this file, plus
    // dozens more rolled into the original v1 before that) were
    // collapsed once it became clear no one else was on an older shape.
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
    //   - `*screenshots` on `days` is multi-entry so the drainer locates
    //     day rows by ref.
    //   - `news.date` — Day page looks up news by date.
    //   - `progress_rules.sort` — `sortBy('sort')` in the rule list.
    //   - `updated_at` everywhere is kept for sync ergonomics — sync
    //     currently calls `.toArray()` but indexed updated_at lets us
    //     migrate to incremental pulls without another schema bump.
    this.version(9).stores({
      trades: '&id, [account_id+date], [account_id+model_id], account_id, updated_at',
      adjustments: '&id, [account_id+date], account_id, updated_at',
      accounts: '&id, updated_at',
      pending_uploads: '&id, account_id',
      days: '&id, [account_id+date], account_id, *screenshots, updated_at',
      models: '&id, account_id, updated_at',
      progress_rules: '&id, account_id, sort, updated_at',
      progress_checks: '&id, [account_id+date], account_id, updated_at',
      news: '&id, date, updated_at',
    })

    this.version(10)

    // v11: adds optional `Day.pnl_override` (non-indexed) — no migration
    // needed, IndexedDB stores are schemaless for unindexed fields.
    this.version(11)

    // v12: adds optional `Day.fees_override` (non-indexed) — informational
    // fees for an override day. No migration needed (unindexed field).
    this.version(12)

    // v13: user-defined per-account symbols. Adds the `symbols` store and the
    // `[account_id+symbol_id]` trades index. Its one-time upgrade has run and
    // been stripped per MIGRATION-PATTERN.
    this.version(13).stores({
      trades:
        '&id, [account_id+date], [account_id+model_id], [account_id+symbol_id], account_id, updated_at',
      symbols: '&id, account_id, updated_at',
    })

    // v14–v18: the emotion vocabulary was renamed while it settled. The
    // one-time upgrade that rewrote the stored values has run and been stripped
    // per MIGRATION-PATTERN.
    this.version(18)

    // v19: a removed free-text trade field was deleted from every stored row.
    // The one-time upgrade has run and been stripped per MIGRATION-PATTERN.
    this.version(19)

    // v20: accounts gain `starting_balance` (unindexed). Until now the only way
    // to fund an account was a seed `deposit`, which is a lie for a prop-firm
    // eval — nothing was transferred. The one-time upgrade folded each
    // account's single seed deposit into its opening balance and dropped the
    // row, leaving the adjustments ledger holding only real cash movements. It
    // has run and been stripped per MIGRATION-PATTERN.
    this.version(20)
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
    starting_balance: 0,
    created_at: ts,
    updated_at: ts,
  })
}

// Garbage-collect hidden progress rules that no longer have any check
// rows referencing them. A rule is soft-deleted (`hidden: true`) when
// the user clicks X on a rule with at least one historical check — the
// row stays so past adherence ratios don't drift. If the user later
// goes back and unchecks every day for that rule, the soft-delete
// becomes a pure tombstone and can be removed safely.
export async function cleanEmptyHiddenRules(): Promise<void> {
  const hidden = await db.progress_rules.filter(r => r.hidden === true).toArray()
  if (hidden.length === 0) return
  const inUse = new Set<string>()
  await db.progress_checks.toCollection().each(c => {
    inUse.add(c.rule_id)
  })
  const stale = hidden.filter(r => !inUse.has(r.id))
  if (stale.length === 0) return
  await db.progress_rules.bulkDelete(stale.map(r => r.id))
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
    | 'hardest_moment'
    | 'wanted_to'
    | 'instead_did'
  >,
): boolean {
  return (
    day.screenshots.length > 0 ||
    !!day.note ||
    typeof day.pnl_override === 'number' ||
    // A day whose only content is the reflection must survive — without these
    // the empty-row collector would delete the journal entry behind the user.
    !!day.hardest_moment ||
    !!day.wanted_to ||
    !!day.instead_did
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
