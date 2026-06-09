// Manual JSON backup / restore — a safety net independent of the Drive sync.
// User clicks Export → gets a .json file. User clicks Import → picks a file,
// the local DB is replaced with its contents.

import type { EntityTable } from 'dexie'
import { db, ensureMainAccount } from '@/db/schema'
import { clearSyncState } from '@/lib/sync'
import type {
  Account,
  Day,
  EquityAdjustment,
  Model,
  NewsEvent,
  ProgressCheck,
  ProgressRule,
  TradeRecord,
} from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'

const BACKUP_VERSION = 6

interface Row {
  id: string
}

interface Spec<T extends Row> {
  fileKey: string
  table: () => EntityTable<T, 'id'>
}

const SPECS = [
  { fileKey: 'accounts',        table: () => db.accounts },
  { fileKey: 'trades',          table: () => db.trades },
  { fileKey: 'adjustments',     table: () => db.adjustments },
  { fileKey: 'days', table: () => db.days },
  { fileKey: 'models',          table: () => db.models },
  { fileKey: 'progress_rules',  table: () => db.progress_rules },
  { fileKey: 'progress_checks', table: () => db.progress_checks },
  { fileKey: 'news',     table: () => db.news },
] as const satisfies ReadonlyArray<Spec<Row>>

interface BackupFile {
  version: number
  exported_at: string
  trades?: TradeRecord[]
  adjustments?: EquityAdjustment[]
  accounts?: Account[]
  days?: Day[]
  models?: Model[]
  progress_rules?: ProgressRule[]
  progress_checks?: ProgressCheck[]
  news?: NewsEvent[]
}

export async function exportBackup(): Promise<void> {
  const arrays = await Promise.all(SPECS.map(s => s.table().toArray()))
  const file: BackupFile = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
  }
  SPECS.forEach((s, i) => {
    ;(file as unknown as Record<string, unknown>)[s.fileKey] = arrays[i]
  })
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
): Promise<Record<string, number>> {
  const text = await file.text()
  let parsed: Partial<BackupFile> & Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Partial<BackupFile> & Record<string, unknown>
  } catch {
    throw new Error('Backup file is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup file is malformed (not an object).')
  }
  // Validate the entire structure up front. The transaction below is
  // destructive (truncates every table), so we refuse anything that
  // isn't shaped like a real backup before touching local data.
  for (const s of SPECS) {
    const v = parsed[s.fileKey]
    if (v === undefined) continue
    if (!Array.isArray(v)) {
      throw new Error(`Backup file is malformed (${s.fileKey} is not an array).`)
    }
    for (const row of v) {
      if (!row || typeof row !== 'object' || typeof (row as Row).id !== 'string') {
        throw new Error(`Backup file is malformed (${s.fileKey} has rows missing a string id).`)
      }
    }
  }
  if (!Array.isArray(parsed.trades)) {
    throw new Error('Backup file is malformed (no trades array).')
  }

  // Back-compat: pre-v4 backups have no accounts and no account_id field. Stamp
  // trades/adjustments to the main account so the imported data is visible.
  const stamp = <T extends { account_id?: string }>(rows: T[]): T[] =>
    rows.map(r => ({ ...r, account_id: r.account_id ?? MAIN_ACCOUNT_ID }))

  const arrays: Row[][] = SPECS.map(s => {
    const v = parsed[s.fileKey]
    const arr = Array.isArray(v) ? (v as Row[]) : []
    return s.fileKey === 'trades' || s.fileKey === 'adjustments'
      ? (stamp(arr as Array<Row & { account_id?: string }>) as Row[])
      : arr
  })

  await db.transaction(
    'rw',
    SPECS.map(s => s.table()),
    async () => {
      for (let i = 0; i < SPECS.length; i++) {
        await SPECS[i].table().clear()
        if (arrays[i].length > 0)
          await (SPECS[i].table() as EntityTable<Row, 'id'>).bulkAdd(arrays[i])
      }
    },
  )
  // Ensure the main account exists even if the backup had no accounts array.
  await ensureMainAccount()

  // The local DB was just wholesale-replaced, so the old sync ledger
  // (`lastSyncedIds` + Drive account fingerprint) no longer describes
  // what's on disk. Clear it so the next sync is treated as a first
  // sync — a full, non-destructive reconcile that keeps every imported
  // row. Without this, rows whose ids were in the stale ledger but
  // absent from Drive get misread as local deletions and dropped.
  clearSyncState()

  const counts: Record<string, number> = {}
  SPECS.forEach((s, i) => {
    counts[s.fileKey] = arrays[i].length
  })
  return counts
}
