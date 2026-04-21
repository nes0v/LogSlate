// Manual JSON backup / restore — a safety net independent of the Drive sync.
// User clicks Export → gets a .json file. User clicks Import → picks a file,
// the local DB is replaced with its contents.

import { db, ensureMainAccount } from '@/db/schema'
import type {
  Account,
  DayScreenshot,
  EquityAdjustment,
  TradeRecord,
} from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'

const BACKUP_VERSION = 5

interface BackupFile {
  version: number
  trades: TradeRecord[]
  adjustments?: EquityAdjustment[]
  accounts?: Account[]
  day_screenshots?: DayScreenshot[]
  exported_at: string
}

export async function exportBackup(): Promise<void> {
  const [trades, adjustments, accounts, day_screenshots] = await Promise.all([
    db.trades.toArray(),
    db.adjustments.toArray(),
    db.accounts.toArray(),
    db.day_screenshots.toArray(),
  ])
  const file: BackupFile = {
    version: BACKUP_VERSION,
    trades,
    adjustments,
    accounts,
    day_screenshots,
    exported_at: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  a.href = url
  a.download = `logslate-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function importBackup(
  file: File,
): Promise<{ imported: number; adjustments: number; accounts: number; dayScreenshots: number }> {
  const text = await file.text()
  const parsed = JSON.parse(text) as Partial<BackupFile>
  if (!parsed || !Array.isArray(parsed.trades)) {
    throw new Error('Backup file is malformed (no trades array).')
  }
  const trades = parsed.trades as TradeRecord[]
  const adjustments = Array.isArray(parsed.adjustments)
    ? (parsed.adjustments as EquityAdjustment[])
    : []
  const accounts = Array.isArray(parsed.accounts) ? (parsed.accounts as Account[]) : []
  const dayScreenshots = Array.isArray(parsed.day_screenshots)
    ? (parsed.day_screenshots as DayScreenshot[])
    : []

  // Back-compat: pre-v4 backups have no accounts and no account_id field. Stamp
  // everything to Main so the imported data is visible in the active account.
  const tradesFixed = trades.map(t => ({ ...t, account_id: t.account_id ?? MAIN_ACCOUNT_ID }))
  const adjustmentsFixed = adjustments.map(a => ({
    ...a,
    account_id: a.account_id ?? MAIN_ACCOUNT_ID,
  }))

  await db.transaction(
    'rw',
    db.trades,
    db.adjustments,
    db.accounts,
    db.day_screenshots,
    async () => {
      await db.trades.clear()
      await db.adjustments.clear()
      await db.accounts.clear()
      await db.day_screenshots.clear()
      if (accounts.length > 0) await db.accounts.bulkAdd(accounts)
      if (tradesFixed.length > 0) await db.trades.bulkAdd(tradesFixed)
      if (adjustmentsFixed.length > 0) await db.adjustments.bulkAdd(adjustmentsFixed)
      if (dayScreenshots.length > 0) await db.day_screenshots.bulkAdd(dayScreenshots)
    },
  )
  // Ensure Main exists even if the backup had no accounts array.
  await ensureMainAccount()
  return {
    imported: tradesFixed.length,
    adjustments: adjustmentsFixed.length,
    accounts: accounts.length,
    dayScreenshots: dayScreenshots.length,
  }
}
