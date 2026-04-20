// Sync engine between local IndexedDB (Dexie) and Google Drive appDataFolder.
//
// Strategy: merge per-trade using `updated_at` (last-write-wins) plus a
// "last-synced IDs" set to distinguish "new on this device" from "deleted on
// the other device". After merge, the combined result is written to both
// local and remote so they converge.

import { db } from '@/db/schema'
import type { EquityAdjustment, TradeRecord } from '@/db/types'
import {
  downloadAppDataFile,
  findAppDataFile,
  uploadAppDataFile,
  type DriveFileMeta,
} from '@/lib/drive'

const FILE_NAME = 'logslate.json'
const LAST_SYNCED_TRADE_IDS_KEY = 'logslate:sync:ids'
const LAST_SYNCED_ADJ_IDS_KEY = 'logslate:sync:adjustment_ids'
const LAST_SYNC_AT_KEY = 'logslate:sync:at'

const FILE_VERSION = 3

interface SyncFile {
  version: number
  trades: TradeRecord[]
  adjustments?: EquityAdjustment[]
  exported_at: string
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

interface SyncItem {
  id: string
  updated_at: string
}

function mergeById<T extends SyncItem>(
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

export function mergeTrades(
  local: TradeRecord[],
  remote: TradeRecord[],
  lastSynced: Set<string>,
): TradeRecord[] {
  return mergeById(local, remote, lastSynced)
}

export function mergeAdjustments(
  local: EquityAdjustment[],
  remote: EquityAdjustment[],
  lastSynced: Set<string>,
): EquityAdjustment[] {
  return mergeById(local, remote, lastSynced)
}

export interface SyncResult {
  remoteCount: number
  localCount: number
  mergedCount: number
  remoteAdjustmentCount: number
  localAdjustmentCount: number
  mergedAdjustmentCount: number
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

export async function syncNow(): Promise<SyncResult> {
  const lastSyncedTrades = loadIdSet(LAST_SYNCED_TRADE_IDS_KEY)
  const lastSyncedAdj = loadIdSet(LAST_SYNCED_ADJ_IDS_KEY)
  const [localTrades, localAdj] = await Promise.all([
    db.trades.toArray(),
    db.adjustments.toArray(),
  ])

  const meta = await findAppDataFile(FILE_NAME)
  let remoteTrades: TradeRecord[] = []
  let remoteAdj: EquityAdjustment[] = []
  if (meta) {
    const text = await downloadAppDataFile(meta.id)
    try {
      const parsed = JSON.parse(text) as Partial<SyncFile>
      if (parsed && Array.isArray(parsed.trades)) {
        remoteTrades = parsed.trades as TradeRecord[]
      }
      if (parsed && Array.isArray(parsed.adjustments)) {
        remoteAdj = parsed.adjustments as EquityAdjustment[]
      }
    } catch {
      // Corrupt file — treat as empty remote; local will overwrite on push.
      remoteTrades = []
      remoteAdj = []
    }
  }

  const mergedTrades = mergeTrades(localTrades, remoteTrades, lastSyncedTrades)
  const mergedAdj = mergeAdjustments(localAdj, remoteAdj, lastSyncedAdj)

  // Replace local in a single transaction across both stores.
  await db.transaction('rw', db.trades, db.adjustments, async () => {
    await db.trades.clear()
    await db.adjustments.clear()
    if (mergedTrades.length > 0) await db.trades.bulkAdd(mergedTrades)
    if (mergedAdj.length > 0) await db.adjustments.bulkAdd(mergedAdj)
  })

  const tradesSame = sameSnapshot(remoteTrades, mergedTrades)
  const adjSame = sameSnapshot(remoteAdj, mergedAdj)
  const remoteSameAsMerged = tradesSame && adjSame

  let uploaded: DriveFileMeta
  let createdRemote = false
  if (remoteSameAsMerged && meta) {
    uploaded = meta
  } else {
    const file: SyncFile = {
      version: FILE_VERSION,
      trades: mergedTrades,
      adjustments: mergedAdj,
      exported_at: new Date().toISOString(),
    }
    uploaded = await uploadAppDataFile({ id: meta?.id, name: FILE_NAME, body: JSON.stringify(file) })
    createdRemote = !meta
  }

  saveIdSet(LAST_SYNCED_TRADE_IDS_KEY, new Set(mergedTrades.map(t => t.id)))
  saveIdSet(LAST_SYNCED_ADJ_IDS_KEY, new Set(mergedAdj.map(a => a.id)))
  const at = new Date().toISOString()
  localStorage.setItem(LAST_SYNC_AT_KEY, at)

  return {
    remoteCount: remoteTrades.length,
    localCount: localTrades.length,
    mergedCount: mergedTrades.length,
    remoteAdjustmentCount: remoteAdj.length,
    localAdjustmentCount: localAdj.length,
    mergedAdjustmentCount: mergedAdj.length,
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
  localStorage.removeItem(LAST_SYNCED_TRADE_IDS_KEY)
  localStorage.removeItem(LAST_SYNCED_ADJ_IDS_KEY)
  localStorage.removeItem(LAST_SYNC_AT_KEY)
}
