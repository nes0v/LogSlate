// Sync engine between local IndexedDB (Dexie) and Google Drive appDataFolder.
//
// Strategy: merge per-trade using `updated_at` (last-write-wins) plus a
// "last-synced IDs" set to distinguish "new on this device" from "deleted on
// the other device". After merge, the combined result is written to both
// local and remote so they converge.

import { db } from '@/db/schema'
import type { TradeRecord } from '@/db/types'
import {
  downloadAppDataFile,
  findAppDataFile,
  uploadAppDataFile,
  type DriveFileMeta,
} from '@/lib/drive'

const FILE_NAME = 'logslate.json'
const LAST_SYNCED_IDS_KEY = 'logslate:sync:ids'
const LAST_SYNC_AT_KEY = 'logslate:sync:at'

const FILE_VERSION = 2

interface SyncFile {
  version: number
  trades: TradeRecord[]
  exported_at: string
}

function loadLastSyncedIds(): Set<string> {
  try {
    const s = localStorage.getItem(LAST_SYNCED_IDS_KEY)
    if (!s) return new Set()
    const arr = JSON.parse(s) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function saveLastSyncedIds(ids: Set<string>): void {
  localStorage.setItem(LAST_SYNCED_IDS_KEY, JSON.stringify(Array.from(ids)))
}

export function lastSyncAt(): Date | null {
  const v = localStorage.getItem(LAST_SYNC_AT_KEY)
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function mergeTrades(
  local: TradeRecord[],
  remote: TradeRecord[],
  lastSynced: Set<string>,
): TradeRecord[] {
  const lMap = new Map(local.map(t => [t.id, t]))
  const rMap = new Map(remote.map(t => [t.id, t]))
  const allIds = new Set([...lMap.keys(), ...rMap.keys()])
  const out: TradeRecord[] = []

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

export interface SyncResult {
  remoteCount: number
  localCount: number
  mergedCount: number
  createdRemote: boolean
  skippedPush: boolean
  fileId: string
  modifiedTime: string
  mergedAt: string
}

export async function syncNow(): Promise<SyncResult> {
  const lastSynced = loadLastSyncedIds()
  const local = await db.trades.toArray()

  const meta = await findAppDataFile(FILE_NAME)
  let remote: TradeRecord[] = []
  if (meta) {
    const text = await downloadAppDataFile(meta.id)
    try {
      const parsed = JSON.parse(text) as Partial<SyncFile>
      if (parsed && Array.isArray(parsed.trades)) remote = parsed.trades as TradeRecord[]
    } catch {
      // Corrupt file — treat as empty remote; local will overwrite on push.
      remote = []
    }
  }

  const merged = mergeTrades(local, remote, lastSynced)

  // Replace local in a single transaction.
  await db.transaction('rw', db.trades, async () => {
    await db.trades.clear()
    if (merged.length > 0) await db.trades.bulkAdd(merged)
  })

  // Only push if the merged result differs from the remote snapshot.
  const remoteSameAsMerged =
    remote.length === merged.length &&
    remote.every(r => {
      const m = merged.find(mm => mm.id === r.id)
      return m && m.updated_at === r.updated_at
    })

  let uploaded: DriveFileMeta
  let createdRemote = false
  if (remoteSameAsMerged && meta) {
    uploaded = meta
  } else {
    const file: SyncFile = { version: FILE_VERSION, trades: merged, exported_at: new Date().toISOString() }
    uploaded = await uploadAppDataFile({ id: meta?.id, name: FILE_NAME, body: JSON.stringify(file) })
    createdRemote = !meta
  }

  const newIds = new Set(merged.map(t => t.id))
  saveLastSyncedIds(newIds)
  const at = new Date().toISOString()
  localStorage.setItem(LAST_SYNC_AT_KEY, at)

  return {
    remoteCount: remote.length,
    localCount: local.length,
    mergedCount: merged.length,
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
  localStorage.removeItem(LAST_SYNCED_IDS_KEY)
  localStorage.removeItem(LAST_SYNC_AT_KEY)
}
