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
  fetchDriveUser,
  findAppDataFile,
  uploadAppDataFile,
  type DriveFileMeta,
} from '@/lib/drive'
import { loadJsonFromStorage, saveJsonToStorage, removeFromStorage } from '@/lib/storage'

const FILE_NAME = 'logslate.json'
const LAST_SYNC_AT_KEY = 'logslate:sync:at'
/** Stable Google permissionId of the Drive account the local data was last
 *  synced to. Compared against the currently signed-in user before every
 *  sync; mismatch hard-blocks to prevent accidental data wipes when the
 *  user signs into a different Google account. */
const DRIVE_USER_KEY = 'logslate:sync:drive_user'
const FILE_VERSION = 6

/** Raised when the currently signed-in Drive user doesn't match the user
 *  whose data is stored locally. Blocks the sync entirely — without this,
 *  the merge would silently treat every local row as "deleted on remote"
 *  and wipe the local DB, then push nothing back (fresh remote) or
 *  contaminate the new account's Drive (existing remote). */
export class DriveAccountMismatchError extends Error {
  constructor(currentEmail: string | null) {
    super(
      currentEmail
        ? `Connected as ${currentEmail}, but local data was last synced to a different Google account. Disconnect and reconnect with the original account, or export a backup before switching.`
        : 'Connected to a different Google account than the one your local data was last synced to. Disconnect and reconnect with the original account, or export a backup before switching.',
    )
    this.name = 'DriveAccountMismatchError'
  }
}

/** Raised when the Drive sync file is missing but `lastSyncedIds` shows we
 *  previously synced. Without this guard, the merge would tombstone every
 *  local row (each is in lastSyncedIds, missing from "remote") and wipe
 *  the local DB. The recoverable answer is to push local up and recreate
 *  the file — handled by `syncNow({ recreateRemoteIfMissing: true })`. */
export class DriveFileGoneError extends Error {
  constructor() {
    super(
      'Your Drive sync file is missing — it may have been deleted from Google Drive. Confirm to push your local data and recreate the file.',
    )
    this.name = 'DriveFileGoneError'
  }
}

/** Raised when the Drive sync file exists but doesn't parse as JSON
 *  (interrupted upload, manual edit, etc.). Without this guard we'd
 *  silently treat remote as empty and let the next push clobber
 *  whatever's there — destructive without user awareness. Recoverable
 *  via `syncNow({ overwriteCorruptRemote: true })` once the user has
 *  confirmed they want to overwrite the corrupted file with local data. */
export class DriveFileCorruptError extends Error {
  constructor() {
    super(
      'Your Drive sync file is corrupted — its JSON could not be parsed. Confirm to overwrite it with your local data.',
    )
    this.name = 'DriveFileCorruptError'
  }
}

/** Raised when the Drive sync file's `version` field is higher than the
 *  one this client knows about. The shape may have new required fields
 *  the older code can't handle, so the safe answer is to refuse and
 *  prompt the user to update this device. Hard-block: no override path,
 *  because the alternative (overwrite with this device's older shape)
 *  would silently lose whatever the newer client added. */
export class DriveFileVersionError extends Error {
  readonly remoteVersion: number
  readonly localVersion: number
  constructor(remoteVersion: number, localVersion: number) {
    super(
      `Your Drive sync file was written by a newer version of LogSlate (v${remoteVersion}, this device speaks v${localVersion}). Update this device before syncing.`,
    )
    this.name = 'DriveFileVersionError'
    this.remoteVersion = remoteVersion
    this.localVersion = localVersion
  }
}

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

interface SyncFile {
  version: number
  exported_at: string
  // Each spec's fileKey gets an array of rows here at write time.
  [key: string]: unknown
}

function loadIdSet(key: string): Set<string> {
  return loadJsonFromStorage(
    key,
    raw =>
      Array.isArray(raw)
        ? new Set(raw.filter((x): x is string => typeof x === 'string'))
        : null,
    new Set<string>(),
  )
}

function saveIdSet(key: string, ids: Set<string>): void {
  saveJsonToStorage(key, Array.from(ids))
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

export interface SyncOptions {
  /** Override the file-gone guard. Use when the user has explicitly
   *  confirmed they want to push local data into a fresh Drive file
   *  (e.g. after `DriveFileGoneError`). Treats lastSyncedIds as empty
   *  for the merge so local rows aren't tombstoned. */
  recreateRemoteIfMissing?: boolean
  /** Override the corrupt-file guard. Use when the user has explicitly
   *  confirmed they want to overwrite an unparseable Drive file with
   *  their local data (after `DriveFileCorruptError`). Proceeds as if
   *  the remote were empty so the next push replaces the bad bytes. */
  overwriteCorruptRemote?: boolean
}

export async function syncNow(options: SyncOptions = {}): Promise<SyncResult> {
  // GUARD 1 — Drive account fingerprint. Detect "user signed into a
  // different Google account since their last sync" before touching any
  // data. Without this, the merge would interpret every local row as
  // "deleted on this account's remote" and wipe the local DB.
  const currentUser = await fetchDriveUser()
  const storedUserId = localStorage.getItem(DRIVE_USER_KEY)
  if (storedUserId && storedUserId !== currentUser.permissionId) {
    throw new DriveAccountMismatchError(currentUser.emailAddress)
  }

  // Per-spec local arrays + last-synced id sets, in parallel.
  const locals: SyncItem[][] = await Promise.all(SPECS.map(s => s.table().toArray()))
  const lastSyncedSets: Set<string>[] = SPECS.map(s => loadIdSet(s.idsKey))

  const meta = await findAppDataFile(FILE_NAME)

  // GUARD 2 — Drive file disappeared. lastSyncedIds shows we synced
  // before, but the file is no longer in appDataFolder (manually deleted,
  // Drive purge, etc). Without this, the merge tombstones every local
  // row as "deleted on remote" and wipes the local DB. The recoverable
  // path is to push local up and recreate; gated behind explicit user
  // confirmation via `recreateRemoteIfMissing`.
  const previouslySynced = lastSyncedSets.some(s => s.size > 0)
  if (!meta && previouslySynced && !options.recreateRemoteIfMissing) {
    throw new DriveFileGoneError()
  }

  // When the user has confirmed recreate-remote, drop lastSyncedIds so
  // the merge keeps every local row instead of tombstoning them.
  const effectiveLastSynced =
    !meta && options.recreateRemoteIfMissing
      ? SPECS.map(() => new Set<string>())
      : lastSyncedSets

  let parsed: Partial<SyncFile> | null = null
  if (meta) {
    const text = await downloadAppDataFile(meta.id)
    try {
      parsed = JSON.parse(text) as Partial<SyncFile>
    } catch {
      // Corrupt file. Without explicit confirmation we abort — silently
      // overwriting would mask a real upstream problem and irreversibly
      // discard whatever the corrupted bytes were. With confirmation,
      // proceed as if remote were empty so the next push replaces it.
      if (!options.overwriteCorruptRemote) throw new DriveFileCorruptError()
      parsed = null
    }
    // Version guard. If the file was written by a newer client, the
    // shape may have fields we can't interpret — proceeding could
    // silently drop data on the next push. No override: the answer is
    // to update this device, not to clobber the newer client's work.
    if (parsed && typeof parsed.version === 'number' && parsed.version > FILE_VERSION) {
      throw new DriveFileVersionError(parsed.version, FILE_VERSION)
    }
  }

  const remotes: SyncItem[][] = SPECS.map(s => readArrayField(parsed, s.fileKey))
  const merged: SyncItem[][] = SPECS.map((_, i) =>
    mergeById(locals[i], remotes[i], effectiveLastSynced[i]),
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
    // Stale-write check. Between our pull and this push, another device
    // could in theory have written to Drive. If so, blindly pushing
    // would silently clobber their changes. Refetch the metadata; if
    // `modifiedTime` advanced past what we pulled, abort. Unreachable
    // under the project's single-device-at-a-time invariant (CLAUDE.md),
    // kept as defense-in-depth.
    if (meta) {
      const fresh = await findAppDataFile(FILE_NAME)
      if (fresh && fresh.modifiedTime !== meta.modifiedTime) {
        throw new Error(
          'Drive file changed during sync (another device pushed). Retry pending.',
        )
      }
    }
    // Save a CONSERVATIVE lastSyncedIds BEFORE the push: only the IDs we
    // KNOW are on Drive right now (= rows that came from this pull,
    // plus rows from the previous lastSynced that survived the merge).
    // Locally-created rows are DELIBERATELY excluded — they're not on
    // Drive yet. If the push then fails:
    //   - A deletion of a row we just merged in from remote is correctly
    //     tombstoned on retry (in lastSynced + in remote + not in local
    //     → drop) instead of resurrecting.
    //   - A locally-created row is NOT silently dropped on retry (not in
    //     lastSynced + only in local → keep) because we held it back.
    // The wider lastSyncedIds = merged set is written AFTER the push
    // succeeds, below.
    SPECS.forEach((_, i) => {
      const known = new Set(lastSyncedSets[i])
      for (const r of remotes[i]) known.add(r.id)
      saveIdSet(SPECS[i].idsKey, known)
    })
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

  // After-push save: every merged row is now on Drive (either it was
  // already there, or this push put it there, or no push was needed
  // because remote already matched). Expand lastSyncedIds to the full
  // merged set so locally-created rows are tracked for future syncs.
  SPECS.forEach((s, i) => saveIdSet(s.idsKey, new Set(merged[i].map(m => m.id))))

  // Stamp the Drive user id so the next sync's GUARD 1 can compare. Saved
  // here (after push) and not on sign-in: until something is actually
  // synced, there's nothing to "fingerprint" — fresh sign-ins to a new
  // account on first install should succeed without a stored id.
  localStorage.setItem(DRIVE_USER_KEY, currentUser.permissionId)
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

// Clear the last-synced state locally. Resets the per-table id sets, the
// Drive user fingerprint, and the last-sync timestamp — used by the tests
// and reserved for an explicit user-initiated "wipe sync state" action.
// NOT called on Drive sign-out: keeping the state across a sign-out lets
// us detect account mismatches AND preserves deletion tombstones for the
// same-account sign-in case.
export function clearSyncState(): void {
  for (const s of SPECS) removeFromStorage(s.idsKey)
  removeFromStorage(LAST_SYNC_AT_KEY)
  removeFromStorage(DRIVE_USER_KEY)
}
