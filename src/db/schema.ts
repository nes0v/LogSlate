import Dexie, { type EntityTable } from 'dexie'
import type {
  Account,
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
