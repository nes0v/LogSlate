// Manual JSON backup / restore — a safety net independent of the Drive sync.
// User clicks Export → gets a .json file. User clicks Import → picks a file,
// the local DB is replaced with its contents.

import type { EntityTable } from 'dexie'
import { db, ensureMainAccount } from '@/db/schema'
import { clearSyncState, markLocalAuthoritative } from '@/lib/sync'
import { refreshAllDayCaches } from '@/lib/day-cache'
import { clearAllSymbolFilterCaches } from '@/lib/symbol-filter-cache'
import { clearPendingDeletes } from '@/lib/drive-images'
import { clearAllLastActivityDates } from '@/lib/last-activity-cache'
import { DATA_TABLES } from '@/lib/data-tables'

const BACKUP_VERSION = 9

interface Row {
  id: string
}

export async function exportBackup(): Promise<void> {
  const arrays = await Promise.all(DATA_TABLES.map(s => s.table().toArray()))
  const file = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    ...Object.fromEntries(DATA_TABLES.map((s, i) => [s.fileKey, arrays[i]])),
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
): Promise<Record<string, number>> {
  const text = await file.text()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('Backup file is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup file is malformed (not an object).')
  }
  if (typeof parsed.version !== 'number') {
    throw new Error('Backup file is malformed (no version).')
  }
  // A newer build's backup may be shaped differently; importing it could
  // drop what this build doesn't understand.
  if (parsed.version > BACKUP_VERSION) {
    throw new Error(
      `Backup file was written by a newer version of LogSlate (v${parsed.version}, this device reads v${BACKUP_VERSION}). Update this device first.`,
    )
  }
  // An older backup holds row shapes this build no longer reads.
  if (parsed.version < BACKUP_VERSION) {
    throw new Error(
      `Backup file is from an older version of LogSlate (v${parsed.version}, this device reads v${BACKUP_VERSION}) and can't be imported.`,
    )
  }
  // Validate the entire structure up front. The transaction below is
  // destructive (truncates every table), so we refuse anything that
  // isn't shaped like a real backup before touching local data.
  for (const s of DATA_TABLES) {
    const v = parsed[s.fileKey]
    if (!Array.isArray(v)) {
      throw new Error(`Backup file is malformed (${s.fileKey} is not an array).`)
    }
    for (const row of v) {
      if (!row || typeof row !== 'object' || typeof (row as Row).id !== 'string') {
        throw new Error(`Backup file is malformed (${s.fileKey} has rows missing a string id).`)
      }
    }
  }
  const arrays: Row[][] = DATA_TABLES.map(s => parsed[s.fileKey] as Row[])

  await db.transaction(
    'rw',
    [...DATA_TABLES.map(s => s.table()), db.pending_uploads],
    async () => {
      for (let i = 0; i < DATA_TABLES.length; i++) {
        await DATA_TABLES[i].table().clear()
        if (arrays[i].length > 0)
          await (DATA_TABLES[i].table() as EntityTable<Row, 'id'>).bulkAdd(arrays[i])
      }
      // Queued screenshot uploads aren't in the backup. Keep the ones a
      // restored day still points at (a backup of this same browser); the
      // rest would upload to Drive as files nothing references.
      const referenced = new Set<string>()
      for (const d of await db.days.toArray()) {
        for (const ref of d.screenshots) {
          if (ref.startsWith('pending:')) referenced.add(ref.slice('pending:'.length))
        }
      }
      const stale = (await db.pending_uploads.toCollection().primaryKeys()).filter(
        id => !referenced.has(id),
      )
      if (stale.length > 0) await db.pending_uploads.bulkDelete(stale)
    },
  )
  // A backup with no accounts still leaves the app somewhere to land.
  await ensureMainAccount()

  // Same reasoning as the sync ledger below: these localStorage snapshots are
  // DERIVED from tables that were just swapped out, so they now describe data
  // that may not exist. Both are first-paint seeds, so a stale one shows the
  // previous database's symbols or date window for a frame before correcting.
  // Per-account preferences (chart type, marker toggles) are deliberately left
  // alone — those are choices the user made, not snapshots of the data.
  clearAllSymbolFilterCaches()
  clearAllLastActivityDates()
  // A queued Drive delete could target a screenshot the restored rows use.
  clearPendingDeletes()

  // The local DB was just wholesale-replaced, so the old sync ledger
  // (`lastSyncedIds` + Drive account fingerprint) no longer describes what's
  // on disk. Clear it, and have the next sync make Drive match what was just
  // imported: a merge would bring back every row the backup left out and let
  // newer Drive edits beat the restored copies.
  clearSyncState()
  markLocalAuthoritative()
  void refreshAllDayCaches()

  const counts: Record<string, number> = {}
  DATA_TABLES.forEach((s, i) => {
    counts[s.fileKey] = arrays[i].length
  })
  return counts
}
