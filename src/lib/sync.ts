// Sync engine between local IndexedDB (Dexie) and Google Drive appDataFolder.
//
// Strategy: merge per-record using `updated_at` (last-write-wins) plus a
// "last-synced IDs" set to distinguish "new on this device" from "deleted on
// the other device". After merge, the combined result is written to both
// local and remote so they converge.
//
// New tables are added by appending to `SPECS` — everything else (loading,
// merging, file format, settings UI counts) is driven off that list.

import type { EntityTable } from 'dexie'
import { db } from '@/db/schema'
import {
  downloadAppDataFile,
  findAppDataFile,
  uploadAppDataFile,
  type DriveFileMeta,
} from '@/lib/drive'

const FILE_NAME = 'logslate.json'
const LAST_SYNC_AT_KEY = 'logslate:sync:at'
const FILE_VERSION = 6

interface SyncItem {
  id: string
  updated_at: string
}

interface SyncSpec {
  /** Field name in the on-disk JSON file. */
  fileKey: string
  /** localStorage key for the last-synced id set. */
  idsKey: string
  /** Lazy table accessor (db isn't constructed until module init runs). */
  table: () => EntityTable<SyncItem, 'id'>
}

const SPECS: SyncSpec[] = [
  { fileKey: 'trades',          idsKey: 'logslate:sync:trade_ids',          table: () => db.trades as unknown as EntityTable<SyncItem, 'id'> },
  { fileKey: 'adjustments',     idsKey: 'logslate:sync:adjustment_ids',     table: () => db.adjustments as unknown as EntityTable<SyncItem, 'id'> },
  { fileKey: 'accounts',        idsKey: 'logslate:sync:account_ids',        table: () => db.accounts as unknown as EntityTable<SyncItem, 'id'> },
  { fileKey: 'days',            idsKey: 'logslate:sync:day_ids',            table: () => db.days as unknown as EntityTable<SyncItem, 'id'> },
  { fileKey: 'models',          idsKey: 'logslate:sync:model_ids',          table: () => db.models as unknown as EntityTable<SyncItem, 'id'> },
  { fileKey: 'progress_rules',  idsKey: 'logslate:sync:progress_rule_ids',  table: () => db.progress_rules as unknown as EntityTable<SyncItem, 'id'> },
  { fileKey: 'progress_checks', idsKey: 'logslate:sync:progress_check_ids', table: () => db.progress_checks as unknown as EntityTable<SyncItem, 'id'> },
  { fileKey: 'news',            idsKey: 'logslate:sync:news_ids',           table: () => db.news as unknown as EntityTable<SyncItem, 'id'> },
]

/** Tables the sync engine pushes/pulls. auto-sync.ts hooks every table in
 *  this list so a write anywhere triggers a debounced push — keeping the
 *  hooked-table set and the synced-table set from drifting. */
export function syncedTables(): EntityTable<SyncItem, 'id'>[] {
  return SPECS.map(s => s.table())
}

interface SyncFile {
  version: number
  exported_at: string
  // Each spec's fileKey gets an array of rows here at write time.
  [key: string]: unknown
}

function loadIdSet(key: string): Set<string> {
  try {
    const s = localStorage.getItem(key)
    if (!s) return new Set()
    const arr = JSON.parse(s) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function saveIdSet(key: string, ids: Set<string>): void {
  localStorage.setItem(key, JSON.stringify(Array.from(ids)))
}

export function lastSyncAt(): Date | null {
  const v = localStorage.getItem(LAST_SYNC_AT_KEY)
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function mergeById<T extends SyncItem>(
  local: T[],
  remote: T[],
  lastSynced: Set<string>,
): T[] {
  const lMap = new Map(local.map(t => [t.id, t]))
  const rMap = new Map(remote.map(t => [t.id, t]))
  const allIds = new Set([...lMap.keys(), ...rMap.keys()])
  const out: T[] = []

  for (const id of allIds) {
    const l = lMap.get(id)
    const r = rMap.get(id)
    if (l && r) {
      out.push(l.updated_at >= r.updated_at ? l : r)
    } else if (l && !r) {
      // Only local has it. If it was in the last-synced set, it was deleted remotely → drop.
      if (!lastSynced.has(id)) out.push(l)
    } else if (!l && r) {
      // Only remote has it. If it was in the last-synced set, it was deleted locally → drop.
      if (!lastSynced.has(id)) out.push(r)
    }
  }
  return out
}

export interface SyncTableCounts {
  local: number
  remote: number
  merged: number
}
export interface SyncResult {
  perTable: Record<string, SyncTableCounts>
  createdRemote: boolean
  skippedPush: boolean
  fileId: string
  modifiedTime: string
  mergedAt: string
}

function sameSnapshot<T extends SyncItem>(remote: T[], merged: T[]): boolean {
  if (remote.length !== merged.length) return false
  const mMap = new Map(merged.map(m => [m.id, m]))
  return remote.every(r => {
    const m = mMap.get(r.id)
    return m !== undefined && m.updated_at === r.updated_at
  })
}

function readArrayField(parsed: Partial<SyncFile> | null, key: string): SyncItem[] {
  const v = parsed?.[key]
  return Array.isArray(v) ? (v as SyncItem[]) : []
}

export async function syncNow(): Promise<SyncResult> {
  // Per-spec local arrays + last-synced id sets, in parallel.
  const locals: SyncItem[][] = await Promise.all(SPECS.map(s => s.table().toArray()))
  const lastSyncedSets: Set<string>[] = SPECS.map(s => loadIdSet(s.idsKey))

  const meta = await findAppDataFile(FILE_NAME)
  let parsed: Partial<SyncFile> | null = null
  if (meta) {
    const text = await downloadAppDataFile(meta.id)
    try {
      parsed = JSON.parse(text) as Partial<SyncFile>
    } catch {
      // Corrupt file — treat as empty remote; local will overwrite on push.
      parsed = null
    }
  }

  const remotes: SyncItem[][] = SPECS.map(s => readArrayField(parsed, s.fileKey))
  const merged: SyncItem[][] = SPECS.map((_, i) =>
    mergeById(locals[i], remotes[i], lastSyncedSets[i]),
  )

  // Single transaction: clear every table then bulk-add the merged rows.
  await db.transaction(
    'rw',
    SPECS.map(s => s.table()),
    async () => {
      for (let i = 0; i < SPECS.length; i++) {
        await SPECS[i].table().clear()
        if (merged[i].length > 0) await SPECS[i].table().bulkAdd(merged[i])
      }
    },
  )

  const remoteSameAsMerged = SPECS.every((_, i) => sameSnapshot(remotes[i], merged[i]))

  let uploaded: DriveFileMeta
  let createdRemote = false
  if (remoteSameAsMerged && meta) {
    uploaded = meta
  } else {
    // Stale-write check. Between our pull (line ~145) and this push,
    // another device could have written to Drive. If so, blindly pushing
    // would silently clobber their changes — `lastSyncedIds` would then
    // mark our merge as "synced" and the next sync would mistake the
    // other device's missing rows for "deleted on this device".
    //
    // Refetch the metadata; if `modifiedTime` advanced past what we
    // pulled, abort. The caller (auto-sync) leaves the local DB merged
    // (still safe — it's a superset that includes our pulled-then-merged
    // remote view), and the next scheduled run will re-pull, re-merge
    // against the new remote, and push the union.
    if (meta) {
      const fresh = await findAppDataFile(FILE_NAME)
      if (fresh && fresh.modifiedTime !== meta.modifiedTime) {
        throw new Error(
          'Drive file changed during sync (another device pushed). Retry pending.',
        )
      }
    }
    const file: SyncFile = {
      version: FILE_VERSION,
      exported_at: new Date().toISOString(),
    }
    SPECS.forEach((s, i) => {
      file[s.fileKey] = merged[i]
    })
    uploaded = await uploadAppDataFile({ id: meta?.id, name: FILE_NAME, body: JSON.stringify(file) })
    createdRemote = !meta
  }

  SPECS.forEach((s, i) => saveIdSet(s.idsKey, new Set(merged[i].map(m => m.id))))
  const at = new Date().toISOString()
  localStorage.setItem(LAST_SYNC_AT_KEY, at)

  const perTable: Record<string, SyncTableCounts> = {}
  SPECS.forEach((s, i) => {
    perTable[s.fileKey] = {
      local: locals[i].length,
      remote: remotes[i].length,
      merged: merged[i].length,
    }
  })

  return {
    perTable,
    createdRemote,
    skippedPush: remoteSameAsMerged,
    fileId: uploaded.id,
    modifiedTime: uploaded.modifiedTime,
    mergedAt: at,
  }
}

// Clear the last-synced state locally — useful when the user signs out and we
// want the next sign-in to treat this as a fresh sync (union of both sides).
export function clearSyncState(): void {
  for (const s of SPECS) localStorage.removeItem(s.idsKey)
  localStorage.removeItem(LAST_SYNC_AT_KEY)
}
