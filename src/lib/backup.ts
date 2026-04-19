// Manual JSON backup / restore — a safety net independent of the Drive sync.
// User clicks Export → gets a .json file. User clicks Import → picks a file,
// the local DB is replaced with its contents.

import { db } from '@/db/schema'
import type { TradeRecord } from '@/db/types'

const BACKUP_VERSION = 2

interface BackupFile {
  version: number
  trades: TradeRecord[]
  exported_at: string
}

export async function exportBackup(): Promise<void> {
  const trades = await db.trades.toArray()
  const file: BackupFile = { version: BACKUP_VERSION, trades, exported_at: new Date().toISOString() }
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

export async function importBackup(file: File): Promise<{ imported: number }> {
  const text = await file.text()
  const parsed = JSON.parse(text) as Partial<BackupFile>
  if (!parsed || !Array.isArray(parsed.trades)) {
    throw new Error('Backup file is malformed (no trades array).')
  }
  const trades = parsed.trades as TradeRecord[]
  await db.transaction('rw', db.trades, async () => {
    await db.trades.clear()
    if (trades.length > 0) await db.trades.bulkAdd(trades)
  })
  return { imported: trades.length }
}
