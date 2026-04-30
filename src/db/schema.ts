import Dexie, { type EntityTable } from 'dexie'
import type {
  Account,
  Day,
  EquityAdjustment,
  Execution,
  Model,
  NewsEvent,
  Note,
  PendingUpload,
  ProgressCheck,
  ProgressRule,
  TradeRecord,
} from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'

interface LegacyV1Trade extends Omit<TradeRecord, 'executions'> {
  buys?: Omit<Execution, 'kind'>[]
  sells?: Omit<Execution, 'kind'>[]
}

class LogslateDB extends Dexie {
  trades!: EntityTable<TradeRecord, 'id'>
  adjustments!: EntityTable<EquityAdjustment, 'id'>
  accounts!: EntityTable<Account, 'id'>
  pending_uploads!: EntityTable<PendingUpload, 'id'>
  days!: EntityTable<Day, 'id'>
  notes!: EntityTable<Note, 'id'>
  models!: EntityTable<Model, 'id'>
  progress_rules!: EntityTable<ProgressRule, 'id'>
  progress_checks!: EntityTable<ProgressCheck, 'id'>
  news!: EntityTable<NewsEvent, 'id'>

  constructor() {
    super('logslate')

    // v1: buys[] / sells[] as separate arrays.
    this.version(1).stores({
      trades: '&id, trade_date, symbol, session, updated_at, created_at',
    })

    // v2: merged executions[] with a `kind` discriminator; sorted by time.
    this.version(2)
      .stores({
        trades: '&id, trade_date, symbol, session, updated_at, created_at',
      })
      .upgrade(async tx => {
        await tx
          .table('trades')
          .toCollection()
          .modify((t: LegacyV1Trade) => {
            const buys = (t.buys ?? []).map(e => ({ ...e, kind: 'buy' as const }))
            const sells = (t.sells ?? []).map(e => ({ ...e, kind: 'sell' as const }))
            const merged = [...buys, ...sells].sort(
              (a, b) => Date.parse(a.time) - Date.parse(b.time),
            )
            ;(t as unknown as TradeRecord).executions = merged
            delete t.buys
            delete t.sells
          })
      })

    // v3: equity adjustments (deposits / withdrawals).
    this.version(3).stores({
      trades: '&id, trade_date, symbol, session, updated_at, created_at',
      adjustments: '&id, date, updated_at, created_at',
    })

    // v4: multi-account support.
    // - new `accounts` table (the Main account is undeletable)
    // - `account_id` added to trades + adjustments, indexed
    // - migration stamps every existing record with MAIN_ACCOUNT_ID and creates
    //   the Main account row if it doesn't already exist
    this.version(4)
      .stores({
        trades: '&id, account_id, trade_date, symbol, session, updated_at, created_at',
        adjustments: '&id, account_id, date, updated_at, created_at',
        accounts: '&id, is_main, updated_at',
      })
      .upgrade(async tx => {
        const ts = new Date().toISOString()
        const accounts = tx.table('accounts')
        const existingMain = await accounts.get(MAIN_ACCOUNT_ID)
        if (!existingMain) {
          await accounts.add({
            id: MAIN_ACCOUNT_ID,
            name: 'Main',
            is_main: true,
            created_at: ts,
            updated_at: ts,
          } satisfies Account)
        }
        await tx
          .table('trades')
          .toCollection()
          .modify((t: TradeRecord) => {
            if (!t.account_id) t.account_id = MAIN_ACCOUNT_ID
          })
        await tx
          .table('adjustments')
          .toCollection()
          .modify((a: EquityAdjustment) => {
            if (!a.account_id) a.account_id = MAIN_ACCOUNT_ID
          })
      })

    // v5: compound indexes so account-scoped date range queries hit the index
    // directly instead of scanning by date then filtering by account_id in JS.
    this.version(5).stores({
      trades:
        '&id, [account_id+trade_date], account_id, trade_date, symbol, session, updated_at, created_at',
      adjustments: '&id, [account_id+date], account_id, date, updated_at, created_at',
      accounts: '&id, is_main, updated_at',
    })

    // v6: trade screenshots live in Google Drive instead of base64-in-record.
    // - `pending_uploads` holds images picked while offline until the next
    //   online sync.
    // - The `screenshot` field on trades becomes a reference string of the
    //   form `drive:{fileId}` or `pending:{pendingId}`; see
    //   src/lib/drive-images.ts. Any legacy base64 value gets wiped here —
    //   there was no production data to migrate.
    // - `screenshot` gets an index so the pending-upload drainer can rewrite
    //   trades pointing at a specific pending id without scanning.
    this.version(6)
      .stores({
        trades:
          '&id, [account_id+trade_date], account_id, trade_date, symbol, session, screenshot, updated_at, created_at',
        adjustments: '&id, [account_id+date], account_id, date, updated_at, created_at',
        accounts: '&id, is_main, updated_at',
        pending_uploads: '&id, created_at',
      })
      .upgrade(async tx => {
        await tx
          .table('trades')
          .toCollection()
          .modify((t: TradeRecord) => {
            const s = t.screenshot
            if (typeof s !== 'string') return
            if (s.startsWith('drive:') || s.startsWith('pending:')) return
            t.screenshot = null
          })
      })

    // v7: organised Drive storage.
    // - `pending_uploads` now carries the precomputed Drive filename and
    //   month_key so the drainer uploads into the right YYYY-MM subfolder
    //   with a human-readable name ("17-apr-2026-trade-1.png", etc.) —
    //   without re-deriving context from trade records that might change.
    // - New `day_screenshots` table for per-day (not per-trade) screenshots.
    //   Renamed to `days` at v18 once it grew to hold more than just the
    //   screenshot field.
    // - Old queued items from v6 are dropped (there was no production
    //   data; the `.clear()` only runs if anything was there).
    this.version(7)
      .stores({
        pending_uploads: '&id, month_key, created_at',
        day_screenshots: '&id, [account_id+date], account_id, date, screenshot, updated_at',
      })
      .upgrade(async tx => {
        // Pending blobs from v6 have different metadata (no filename/month_key)
        // and can't be replayed by the v7 drainer, so drop them — and clear
        // any trade refs that pointed at them so the UI doesn't keep trying
        // to resolve missing blobs.
        await tx.table('pending_uploads').clear()
        await tx
          .table('trades')
          .toCollection()
          .modify((t: TradeRecord) => {
            if (typeof t.screenshot === 'string' && t.screenshot.startsWith('pending:')) {
              t.screenshot = null
            }
          })
      })

    // v8: rating "meh" renamed to "egg" (emoji stays 🥚, just a label change
    // in code). Any existing trades carrying "meh" are rewritten so they
    // still pass the zod enum on load.
    this.version(8).upgrade(async tx => {
      await tx
        .table('trades')
        .toCollection()
        .modify((t: TradeRecord) => {
          if ((t.rating as string) === 'meh') {
            ;(t as { rating: string }).rating = 'egg'
          }
        })
    })

    // v9: per-account Drive screenshot organisation. Each account gets its
    // own `LogSlate/{accountName}/YYYY-MM/` tree, so uploads queued while
    // offline need to remember which account they belong to. Existing rows
    // get stamped with MAIN_ACCOUNT_ID so the drainer routes them into the
    // Main account's folder.
    this.version(9)
      .stores({
        pending_uploads: '&id, account_id, month_key, created_at',
      })
      .upgrade(async tx => {
        await tx
          .table('pending_uploads')
          .toCollection()
          .modify((p: PendingUpload) => {
            if (!p.account_id) p.account_id = MAIN_ACCOUNT_ID
          })
      })

    // v10: journal + playbook + progress tracker. Four new tables, no
    // migration of existing data needed (they're brand new).
    this.version(10).stores({
      notes:
        '&id, [account_id+folder], [account_id+template_kind], account_id, folder, template_kind, updated_at, created_at',
      playbooks:
        '&id, [account_id+archived], account_id, archived, updated_at, created_at',
      progress_rules:
        '&id, [account_id+active], account_id, active, sort, updated_at',
      progress_checks:
        '&id, [account_id+date], account_id, date, rule_id, updated_at',
    })

    // v11: pnl_override removed. Drop the field from existing records.
    // Guarded so Dexie doesn't rewrite rows that never had the property.
    this.version(11).upgrade(async tx => {
      await tx
        .table('trades')
        .toCollection()
        .modify((t: TradeRecord & { pnl_override?: unknown }) => {
          if ('pnl_override' in t) delete t.pnl_override
        })
    })

    // v12: persisted USD high/medium-impact news drivers per NY day. Indexed
    // on `date` so the Day page can pull a single day's events in one query.
    // Renamed to `news` at v18.
    this.version(12).stores({
      news_events: '&id, date, updated_at',
    })

    // v13: drop the cancelled/last_seen_at fields — the table now mirrors
    // the latest feed exactly (postponed events are deleted, not flagged).
    this.version(13).upgrade(async tx => {
      const t = tx.table('news_events')
      type LegacyRow = NewsEvent & { cancelled?: boolean; last_seen_at?: unknown }
      const stale = await t.filter((r: LegacyRow) => r.cancelled === true).primaryKeys()
      if (stale.length > 0) await t.bulkDelete(stale)
      await t.toCollection().modify((r: LegacyRow) => {
        if ('cancelled' in r) delete r.cancelled
        if ('last_seen_at' in r) delete r.last_seen_at
      })
    })

    // v14: rename "playbook" → "model" everywhere it persists. Existing
    // models are intentionally NOT migrated — the user opted to start the
    // model layer fresh under the new naming. We just:
    //   - create the empty `models` store,
    //   - clear `playbook_id` / `playbook_rules_followed` from every trade
    //     so no row points at the soon-to-be-deleted store.
    // v15 drops the legacy `playbooks` store.
    this.version(14)
      .stores({
        models:
          '&id, [account_id+archived], account_id, archived, updated_at, created_at',
      })
      .upgrade(async tx => {
        type LegacyTrade = TradeRecord & {
          playbook_id?: string | null
          playbook_rules_followed?: string[]
        }
        await tx
          .table('trades')
          .toCollection()
          .modify((t: LegacyTrade) => {
            if ('playbook_id' in t) delete t.playbook_id
            if ('playbook_rules_followed' in t) delete t.playbook_rules_followed
            t.model_id = null
            t.model_rules_followed = []
          })
      })

    // v15: drop the legacy `playbooks` store (never repopulated).
    this.version(15).stores({ playbooks: null })

    // v16: a previous v14 had copied playbooks data into the new `models`
    // store before the user opted to start fresh. Wipe whatever is there
    // so the Models page lands empty on next open.
    this.version(16).upgrade(async tx => {
      await tx.table('models').clear()
    })

    // v17: full reset. The Drive sync wipe accidentally cascaded into local
    // trades / accounts via the merge-on-empty-remote branch in sync.ts;
    // unsynced tables (progress, journal, news) survived. To leave the DB
    // in a uniformly-empty state across sync boundaries, we clear every
    // user-data store here. Followed by ensureMainAccount() at app start
    // to seed the default 'main' account.
    this.version(17).upgrade(async tx => {
      const tables = [
        'trades',
        'adjustments',
        'accounts',
        'pending_uploads',
        'day_screenshots',
        'notes',
        'models',
        'progress_rules',
        'progress_checks',
        'news_events',
      ]
      for (const name of tables) await tx.table(name).clear()
    })

    // v18: rename storage to match the user-facing model and reshape the
    // day store to support multiple screenshots per day.
    //   - `day_screenshots` → `days`. One row per (account, date), id
    //     derived as `${account_id}:${date}`. `screenshots` is a multi-
    //     entry indexed array (`*screenshots`) so the pending-upload
    //     drainer can locate rows by ref the same way it does for trades.
    //   - `news_events` → `news` (drop the redundant suffix).
    // v17 already wiped both tables, so no data needs to be copied; the
    // new stores are created empty here, and v19 drops the old shells.
    this.version(18).stores({
      days: '&id, [account_id+date], account_id, date, *screenshots, updated_at',
      news: '&id, date, updated_at',
    })

    // v19: drop the legacy shells now that v18's replacements are live.
    this.version(19).stores({
      day_screenshots: null,
      news_events: null,
    })

    // v20: rename `trades.trade_date` → `trades.date` to match the rest of
    // the schema (adjustments, days, progress_checks, news all use `date`).
    // Reindex the compound `[account_id+trade_date]` index as
    // `[account_id+date]`. Walk every row to copy the field; the v17 wipe
    // means this is usually a no-op for the empty case.
    this.version(20)
      .stores({
        trades:
          '&id, [account_id+date], account_id, date, symbol, session, screenshot, updated_at, created_at',
      })
      .upgrade(async tx => {
        type LegacyTrade = TradeRecord & { trade_date?: string }
        await tx
          .table('trades')
          .toCollection()
          .modify((t: LegacyTrade) => {
            if ('trade_date' in t) {
              t.date = t.trade_date as string
              delete t.trade_date
            }
          })
      })

    // v21: drop the never-used `market_condition` and `conviction` reflection
    // fields. Both were on TradeRecord as optional but no UI ever surfaced
    // them, so any persisted value was leftover from earlier prototyping.
    this.version(21).upgrade(async tx => {
      await tx
        .table('trades')
        .toCollection()
        .modify(
          (
            t: TradeRecord & {
              market_condition?: unknown
              conviction?: unknown
            },
          ) => {
            if ('market_condition' in t) delete t.market_condition
            if ('conviction' in t) delete t.conviction
          },
        )
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

// Clears any trade / day-row references that point at pending uploads which
// no longer exist in the queue. Happens when an old schema upgrade wipes
// legacy pending blobs but leaves records still referring to them, which
// would otherwise show as "Pending upload missing" forever.
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
      if (filtered.length === 0) {
        await db.days.delete(d.id)
      } else {
        await db.days.update(d.id, { screenshots: filtered, updated_at: now })
      }
    }
  })
}
