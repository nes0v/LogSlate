import Dexie, { type EntityTable } from 'dexie'
import type {
  Account,
  DayScreenshot,
  EquityAdjustment,
  Execution,
  PendingUpload,
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
  day_screenshots!: EntityTable<DayScreenshot, 'id'>

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
    //   Id is `${account_id}:${date}` so cross-device sync produces the
    //   same row naturally. One screenshot per (account, date).
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
  }
}

export const db = new LogslateDB()

// Ensures the Main account exists even on a fresh DB (no v3→v4 upgrade path
// ran, because the DB was created straight at v4). Safe to call repeatedly.
export async function ensureMainAccount(): Promise<void> {
  const existing = await db.accounts.get(MAIN_ACCOUNT_ID)
  if (existing) return
  const ts = new Date().toISOString()
  await db.accounts.put({
    id: MAIN_ACCOUNT_ID,
    name: 'Main',
    is_main: true,
    created_at: ts,
    updated_at: ts,
  })
}

// Clears any trade / day-screenshot references that point at pending uploads
// that no longer exist in the queue. Happens when the v6→v7 schema upgrade
// wipes legacy pending blobs but leaves the records still referring to them,
// which would show as "Pending upload missing" forever.
//
// Also deletes any day_screenshot rows whose screenshot field is null —
// those only existed under the old one-row-per-day model where null meant
// "cleared"; in the multi-per-day model a missing screenshot is just zero
// rows, so null rows are orphans.
//
// Safe to call repeatedly; cheap when there's nothing to do.
export async function cleanOrphanedPendingRefs(): Promise<void> {
  const [staleTrades, staleDays, emptyDays, pending] = await Promise.all([
    db.trades.where('screenshot').startsWith('pending:').toArray(),
    db.day_screenshots.where('screenshot').startsWith('pending:').toArray(),
    db.day_screenshots.filter(d => d.screenshot === null).toArray(),
    db.pending_uploads.toArray(),
  ])
  if (
    staleTrades.length === 0 &&
    staleDays.length === 0 &&
    emptyDays.length === 0
  ) {
    return
  }
  const live = new Set(pending.map(p => p.id))
  const now = new Date().toISOString()
  await db.transaction('rw', db.trades, db.day_screenshots, async () => {
    for (const t of staleTrades) {
      const pid = t.screenshot?.slice('pending:'.length)
      if (!pid || !live.has(pid)) {
        await db.trades.update(t.id, { screenshot: null, updated_at: now })
      }
    }
    for (const d of staleDays) {
      const pid = d.screenshot?.slice('pending:'.length)
      if (!pid || !live.has(pid)) {
        await db.day_screenshots.delete(d.id)
      }
    }
    for (const d of emptyDays) {
      await db.day_screenshots.delete(d.id)
    }
  })
}
