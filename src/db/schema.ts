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
    // v4: ProgressRule gains a `periods` array (effective date ranges) and
    // drops the boolean `active`. Backfill from `created_at` so historical
    // adherence stays anchored to when a rule first appeared — active
    // rules become one open period from their creation date; inactive
    // rules become empty (matches current behavior, which excludes them
    // from every day's denominator).
    this.version(4).upgrade(async tx => {
      await tx.table('progress_rules').toCollection().modify((r: {
        created_at?: string
        active?: boolean
        periods?: unknown
      }) => {
        const from = (r.created_at ?? '').slice(0, 10) || '0001-01-01'
        r.periods = r.active === true ? [{ from, until: null }] : []
        delete r.active
      })
    })
    // v5: heal `periods` against actual check history. v4 anchored each
    // rule's earliest period to its `created_at`, but checks recorded
    // before that date (backfilled days, cross-device sync skew, rules
    // recreated after their first use) leave the heat strip blank for
    // dates that legitimately had adherence data. Widen the earliest
    // period — and resurrect periods for rules that ended up empty but
    // have checks — using the oldest checked `progress_checks` row per
    // rule_id.
    this.version(5).upgrade(async tx => {
      const checks = await tx.table('progress_checks').toArray()
      const earliest = new Map<string, string>()
      const latest = new Map<string, string>()
      for (const c of checks as Array<{ rule_id: string; date: string; checked: boolean }>) {
        if (!c.checked) continue
        const e = earliest.get(c.rule_id)
        if (!e || c.date < e) earliest.set(c.rule_id, c.date)
        const l = latest.get(c.rule_id)
        if (!l || c.date > l) latest.set(c.rule_id, c.date)
      }
      await tx.table('progress_rules').toCollection().modify((r: {
        id: string
        periods?: Array<{ from: string; until: string | null }>
      }) => {
        const earliestCheck = earliest.get(r.id)
        if (!earliestCheck) return
        const periods = Array.isArray(r.periods) ? r.periods.slice() : []
        if (periods.length === 0) {
          // Rule has check history but no period — must have been active
          // back then. Reconstruct a closed period spanning the earliest
          // to the latest check. User can re-open it from the UI if the
          // rule is still in effect.
          periods.push({
            from: earliestCheck,
            until: latest.get(r.id) ?? earliestCheck,
          })
        } else if (earliestCheck < periods[0].from) {
          periods[0] = { ...periods[0], from: earliestCheck }
        } else {
          return
        }
        r.periods = periods
      })
    })
    // v6: widen each rule's earliest period to the earliest check on the
    // *account*, not just the earliest check on that rule. v5 used the
    // per-rule earliest, which silently drops rules from past days where
    // the user happened not to tick them — inflating those days to 100%
    // by hiding the failing rules. Old code treated every currently-
    // active rule as part of the denominator on every past day, and
    // that's the behavior we need to preserve. Rules that have never
    // been checked anywhere are skipped — they're either brand-new or
    // genuinely unused, and shouldn't retro-apply to history.
    //
    // Superseded by v7's authoritative reset — left in place because
    // schema versions can't be removed, but the modify() below would
    // also be undone by v7 even if it diverged.
    this.version(6).upgrade(async tx => {
      const checks = await tx.table('progress_checks').toArray()
      const earliestByAccount = new Map<string, string>()
      const ruleSeen = new Set<string>()
      for (const c of checks as Array<{
        account_id: string
        rule_id: string
        date: string
        checked: boolean
      }>) {
        if (!c.checked) continue
        ruleSeen.add(c.rule_id)
        const cur = earliestByAccount.get(c.account_id)
        if (!cur || c.date < cur) earliestByAccount.set(c.account_id, c.date)
      }
      await tx.table('progress_rules').toCollection().modify((r: {
        id: string
        account_id: string
        periods?: Array<{ from: string; until: string | null }>
      }) => {
        if (!ruleSeen.has(r.id)) return
        const earliest = earliestByAccount.get(r.account_id)
        if (!earliest) return
        const periods = Array.isArray(r.periods) ? r.periods.slice() : []
        if (periods.length === 0) {
          periods.push({ from: earliest, until: null })
        } else if (earliest < periods[0].from) {
          periods[0] = { ...periods[0], from: earliest }
        } else {
          return
        }
        r.periods = periods
      })
    })
    // v7: hand-authored reset. The four named rules become the active
    // routine starting 2026-05-11; every other rule is wiped of periods
    // (and so disappears from every day, past and present). One-time
    // fix-up for the single user of this app — text matching is
    // case-insensitive but otherwise exact, no fuzzy variants.
    this.version(7).upgrade(async tx => {
      const KEEP_TEXTS = new Set([
        'read yesterdays notes',
        'write a daily review',
        'do a tapereading session',
        '1 trade only',
      ])
      const ROUTINE_START = '2026-05-11'
      await tx.table('progress_rules').toCollection().modify((r: {
        text?: string
        periods?: Array<{ from: string; until: string | null }>
      }) => {
        const normalized = (r.text ?? '').trim().toLowerCase()
        if (KEEP_TEXTS.has(normalized)) {
          r.periods = [{ from: ROUTINE_START, until: null }]
        } else {
          r.periods = []
        }
      })
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

// One-time cleanup of `progress_checks` rows with `checked: false`. These
// were written by the old `toggleCheck` path that stored a row even when
// the user unchecked. Read paths treat missing rows and `checked: false`
// rows identically, so the false rows are inert — they only inflate row
// counts (visible in the sync report) and waste a Drive payload byte each.
// Cheap when there's nothing to do; safe to run on every boot.
export async function cleanFalseProgressChecks(): Promise<void> {
  const stale = await db.progress_checks.filter(c => !c.checked).toArray()
  if (stale.length === 0) return
  await db.progress_checks.bulkDelete(stale.map(c => c.id))
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
