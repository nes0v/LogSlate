// Trade and day screenshot storage in the user's Google Drive.
//
// The `screenshot` field on a record is a reference string:
//   null             — no screenshot
//   'drive:{id}'     — lives in the user's Drive, fileId = {id}
//   'pending:{id}'   — local-only blob waiting to be uploaded on next online sync
//
// Files are organised per account, by month:
//
//   LogSlate/
//     {accountName}/           ← cached by account id, not name (safe on rename)
//       YYYY-MM/
//         17-apr-2026-trade-3.png
//
// Filenames are built at enqueue time from a caller-supplied date and suffix
// so they're human-readable when the user browses the folder in Drive.
//
// Uploads happen immediately when online; when offline, the blob is stashed in
// the `pending_uploads` IndexedDB table along with its account, precomputed
// filename and month_key, and the record's screenshot field is set to
// `pending:{id}`. A separate drain pass (wired into auto-sync) uploads pending
// blobs into their owning account's folder and rewrites the reference to
// `drive:{id}`.

import { db } from '@/db/schema'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import { getActiveAccountId } from '@/lib/active-account'
import {
  createDriveFolder,
  deleteDriveFile,
  downloadDriveFile,
  driveFileExists,
  DriveScopeError,
  driveViewLink,
  findDriveFolder,
  getDriveState,
  uploadDriveFile,
} from '@/lib/drive'
import { pushError } from '@/lib/notifications'

const TOP_FOLDER_NAME = 'LogSlate'

// Per-account cache keys. The old global keys
// `logslate:drive:screenshots_folder` / `logslate:drive:month_folders` are
// intentionally abandoned — they mapped to the flat pre-per-account layout
// and would be wrong under the new structure.
function accountFolderKey(accountId: string): string {
  return `logslate:drive:screenshots_folder:${accountId}`
}
function monthFolderMapKey(accountId: string): string {
  return `logslate:drive:month_folders:${accountId}`
}

function loadCachedAccountFolderId(accountId: string): string | null {
  try {
    return localStorage.getItem(accountFolderKey(accountId))
  } catch {
    return null
  }
}

function saveCachedAccountFolderId(accountId: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(accountFolderKey(accountId), id)
    else localStorage.removeItem(accountFolderKey(accountId))
  } catch {
    // localStorage unavailable — we'll find the folder again next time.
  }
}

function loadMonthFolderMap(accountId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(monthFolderMapKey(accountId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function saveMonthFolderMap(accountId: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(monthFolderMapKey(accountId), JSON.stringify(map))
  } catch {
    // localStorage unavailable — we'll re-resolve on each session.
  }
}

// Top-level "LogSlate" folder — same for every account, so we memoise it at
// module scope for the session (no localStorage; a single findDriveFolder
// call per page load is cheap).
let topFolderPromise: Promise<string> | null = null
// In-flight per-account and per-(account+month) resolutions, deduped so
// parallel callers don't each create a folder.
const accountFolderPromises = new Map<string, Promise<string>>()
const monthFolderPromises = new Map<string, Promise<string>>()

async function getOrCreateTopFolder(): Promise<string> {
  if (topFolderPromise) return topFolderPromise
  topFolderPromise = (async () => {
    const existing = await findDriveFolder(TOP_FOLDER_NAME)
    if (existing) return existing
    return createDriveFolder(TOP_FOLDER_NAME)
  })()
  try {
    return await topFolderPromise
  } catch (e) {
    topFolderPromise = null
    throw e
  }
}

async function accountFolderName(accountId: string): Promise<string> {
  const rec = await db.accounts.get(accountId)
  // Fall back to the account id so uploads still land somewhere predictable
  // if the account row is missing (shouldn't happen under normal use).
  return rec?.name?.trim() || accountId
}

async function getOrCreateAccountScreenshotsFolder(accountId: string): Promise<string> {
  const inFlight = accountFolderPromises.get(accountId)
  if (inFlight) return inFlight
  const p = (async () => {
    const cached = loadCachedAccountFolderId(accountId)
    if (cached) {
      try {
        if (await driveFileExists(cached)) return cached
      } catch {
        // Treat any error as "cache is stale"; fall through to re-find.
      }
      saveCachedAccountFolderId(accountId, null)
    }
    const topId = await getOrCreateTopFolder()
    const name = await accountFolderName(accountId)
    const existing = await findDriveFolder(name, topId)
    if (existing) {
      saveCachedAccountFolderId(accountId, existing)
      return existing
    }
    const created = await createDriveFolder(name, topId)
    saveCachedAccountFolderId(accountId, created)
    return created
  })()
  accountFolderPromises.set(accountId, p)
  try {
    return await p
  } catch (e) {
    accountFolderPromises.delete(accountId)
    throw e
  }
}

async function getOrCreateMonthFolder(accountId: string, monthKey: string): Promise<string> {
  const cacheKey = `${accountId}:${monthKey}`
  const inFlight = monthFolderPromises.get(cacheKey)
  if (inFlight) return inFlight
  const p = (async () => {
    const accountFolder = await getOrCreateAccountScreenshotsFolder(accountId)
    const map = loadMonthFolderMap(accountId)
    const hit = map[monthKey]
    if (hit) {
      try {
        if (await driveFileExists(hit)) return hit
      } catch {
        // Treat any error as "cache is stale"; fall through to re-find.
      }
      delete map[monthKey]
      saveMonthFolderMap(accountId, map)
    }
    const found = await findDriveFolder(monthKey, accountFolder)
    if (found) {
      map[monthKey] = found
      saveMonthFolderMap(accountId, map)
      return found
    }
    const created = await createDriveFolder(monthKey, accountFolder)
    map[monthKey] = created
    saveMonthFolderMap(accountId, map)
    return created
  })()
  monthFolderPromises.set(cacheKey, p)
  try {
    return await p
  } catch (e) {
    monthFolderPromises.delete(cacheKey)
    throw e
  }
}

// --- reference-string helpers ---

export type ScreenshotRef =
  | { kind: 'drive'; fileId: string }
  | { kind: 'pending'; pendingId: string }
  | null

export function parseScreenshotRef(raw: string | null | undefined): ScreenshotRef {
  if (!raw) return null
  if (raw.startsWith('drive:')) return { kind: 'drive', fileId: raw.slice('drive:'.length) }
  if (raw.startsWith('pending:')) return { kind: 'pending', pendingId: raw.slice('pending:'.length) }
  return null
}

export function formatScreenshotRef(ref: ScreenshotRef): string | null {
  if (!ref) return null
  return ref.kind === 'drive' ? `drive:${ref.fileId}` : `pending:${ref.pendingId}`
}

export function driveViewUrlFromRef(ref: ScreenshotRef): string | null {
  if (ref && ref.kind === 'drive') return driveViewLink(ref.fileId)
  return null
}

// --- filename building ---

const MONTH_ABBR = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const

// YYYY-MM-DD → "2026-04" (sortable, matches folder names).
export function monthKey(date: string): string {
  return date.slice(0, 7)
}

// "image/png" → "png"; anything unparseable → "bin".
export function extensionFromBlobType(type: string | undefined | null): string {
  const ext = type?.split('/')[1]?.toLowerCase()?.replace(/[^a-z0-9]/g, '')
  if (!ext) return 'bin'
  return ext
}

// YYYY-MM-DD + "trade-3" + "png" → "17-apr-2026-trade-3.png".
export function buildFilename(date: string, suffix: string, ext: string): string {
  const [y, m, d] = date.split('-')
  const mi = Number(m) - 1
  const mon = mi >= 0 && mi < 12 ? MONTH_ABBR[mi] : m
  const safeSuffix = suffix.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'screenshot'
  return `${d}-${mon}-${y}-${safeSuffix}.${ext}`
}

// --- upload / pending-queue ---

function newId(): string {
  return crypto.randomUUID()
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function canUploadToDrive(): boolean {
  return getDriveState().status === 'signed-in' && isOnline()
}

export interface ScreenshotContext {
  date: string // YYYY-MM-DD — drives the month folder + filename
  filenameSuffix: string // e.g. "trade-3", "day"
}

interface ResolvedFilename {
  filename: string
  month_key: string
}

function resolveFilename(blob: Blob, ctx: ScreenshotContext): ResolvedFilename {
  return {
    filename: buildFilename(ctx.date, ctx.filenameSuffix, extensionFromBlobType(blob.type)),
    month_key: monthKey(ctx.date),
  }
}

async function uploadDirectly(
  blob: Blob,
  resolved: ResolvedFilename,
  accountId: string,
): Promise<string> {
  const folderId = await getOrCreateMonthFolder(accountId, resolved.month_key)
  const { id } = await uploadDriveFile({
    name: resolved.filename,
    body: blob,
    parentId: folderId,
  })
  const ref = `drive:${id}`
  // Prime the render cache with the bytes we already have so the preview
  // renders instantly instead of doing a round-trip to re-download the file
  // we literally just uploaded (which also hides any transient propagation
  // blips).
  rememberUrl(ref, URL.createObjectURL(blob))
  return ref
}

async function enqueuePending(
  blob: Blob,
  resolved: ResolvedFilename,
  accountId: string,
): Promise<string> {
  const id = newId()
  const now = new Date().toISOString()
  await db.pending_uploads.add({
    id,
    account_id: accountId,
    blob,
    filename: resolved.filename,
    month_key: resolved.month_key,
    created_at: now,
  })
  const ref = `pending:${id}`
  rememberUrl(ref, URL.createObjectURL(blob))
  return ref
}

// Called by the trade form / day page when the user picks a screenshot.
// Returns the reference string to store on the record. Uploads immediately
// when possible; falls back to the pending queue otherwise. The upload is
// tagged with the currently active account so it lands in that account's
// Drive folder even if the user switches accounts before the queue drains.
export async function storeScreenshot(blob: Blob, ctx: ScreenshotContext): Promise<string> {
  const resolved = resolveFilename(blob, ctx)
  const accountId = getActiveAccountId()
  if (!canUploadToDrive()) return enqueuePending(blob, resolved, accountId)
  try {
    return await uploadDirectly(blob, resolved, accountId)
  } catch (e) {
    // Keep the image either way — the drainer will retry. Scope errors need
    // user action, so surface them to the notification banner too.
    if (e instanceof DriveScopeError) {
      pushError(e.message, { label: 'Reconnect', to: '/settings' })
    }
    return enqueuePending(blob, resolved, accountId)
  }
}

// Best-effort: remove the underlying blob when a screenshot is detached. For
// Drive refs, delete the Drive file so the folder doesn't accumulate
// duplicates when the user replaces a screenshot (filenames are stable per
// date+suffix, so a second upload creates a second file in the folder). For
// pending refs, drop the queued blob. Failures are swallowed — the field on
// the record is the source of truth for the user.
export async function discardScreenshotRef(raw: string | null): Promise<void> {
  const ref = parseScreenshotRef(raw)
  if (!ref) return
  if (raw) revokeCached(raw)
  if (ref.kind === 'pending') {
    try {
      await db.pending_uploads.delete(ref.pendingId)
    } catch {
      // ignore
    }
    return
  }
  try {
    await deleteDriveFile(ref.fileId)
  } catch {
    // The user sees the new file in their folder regardless; log would be
    // noise here. Orphaned files can be deleted manually from Drive.
  }
}

// --- rendering ---
//
// Bounded LRU cache mapping a reference string to a blob URL. Keeps repeated
// renders of the same screenshot (e.g. re-opening a trade) from re-fetching.
// Evicted entries have their blob URLs revoked so long-lived sessions don't
// accumulate detached ObjectURLs.
const MAX_CACHED_URLS = 24
const urlCache = new Map<string, string>()

function revokeCached(ref: string): void {
  const existing = urlCache.get(ref)
  if (existing) {
    URL.revokeObjectURL(existing)
    urlCache.delete(ref)
  }
}

function rememberUrl(ref: string, url: string): void {
  if (urlCache.has(ref)) revokeCached(ref)
  urlCache.set(ref, url)
  while (urlCache.size > MAX_CACHED_URLS) {
    const oldest = urlCache.keys().next().value
    if (oldest === undefined) break
    revokeCached(oldest)
  }
}

async function blobForPending(pendingId: string): Promise<Blob | null> {
  const rec = await db.pending_uploads.get(pendingId)
  return rec?.blob ?? null
}

async function blobForDrive(fileId: string): Promise<Blob> {
  return downloadDriveFile(fileId)
}

// Resolves a ref to a blob URL suitable for `<img src>`. Throws on failure
// (missing pending blob, Drive fetch error, scope issue) so callers can
// surface a meaningful message — swallowing made "image won't load" bugs
// impossible to diagnose without devtools.
export async function resolveScreenshotUrl(raw: string | null | undefined): Promise<string> {
  if (!raw) throw new Error('No screenshot ref')
  const cached = urlCache.get(raw)
  if (cached) return cached
  const ref = parseScreenshotRef(raw)
  if (!ref) throw new Error(`Unrecognised screenshot ref: ${raw}`)
  const blob =
    ref.kind === 'pending' ? await blobForPending(ref.pendingId) : await blobForDrive(ref.fileId)
  if (!blob) {
    throw new Error(
      ref.kind === 'pending'
        ? 'Pending upload is missing locally — it may have been cleared.'
        : 'Drive returned no file bytes.',
    )
  }
  const url = URL.createObjectURL(blob)
  rememberUrl(raw, url)
  return url
}

// --- queue drain (called from auto-sync when online + signed-in) ---

export async function drainPendingUploads(): Promise<void> {
  if (!canUploadToDrive()) return
  const pending = await db.pending_uploads.toArray()
  for (const p of pending) {
    try {
      // Back-compat: rows queued before the per-account refactor were stamped
      // with MAIN_ACCOUNT_ID by the v9 migration, so they still resolve to a
      // concrete folder here.
      const accountId = p.account_id || MAIN_ACCOUNT_ID
      const folderId = await getOrCreateMonthFolder(accountId, p.month_key)
      const { id: driveId } = await uploadDriveFile({
        name: p.filename,
        body: p.blob,
        parentId: folderId,
      })
      const oldRef = `pending:${p.id}`
      const newRef = `drive:${driveId}`
      // Rewrite any records that pointed at this pending id (both trades and
      // day_screenshots use the same ref format).
      await db.transaction(
        'rw',
        db.trades,
        db.day_screenshots,
        db.pending_uploads,
        async () => {
          const now = new Date().toISOString()
          const affectedTrades = await db.trades.where('screenshot').equals(oldRef).toArray()
          for (const t of affectedTrades) {
            await db.trades.update(t.id, { screenshot: newRef, updated_at: now })
          }
          const affectedDays = await db.day_screenshots
            .where('screenshot')
            .equals(oldRef)
            .toArray()
          for (const d of affectedDays) {
            await db.day_screenshots.update(d.id, { screenshot: newRef, updated_at: now })
          }
          await db.pending_uploads.delete(p.id)
        },
      )
      const cachedUrl = urlCache.get(oldRef)
      if (cachedUrl) {
        urlCache.delete(oldRef)
        rememberUrl(newRef, cachedUrl)
      }
    } catch (e) {
      // Scope errors will re-happen for every pending item until the user
      // reconnects; bubble them so the sync coordinator surfaces one
      // notification and stops draining instead of spamming the queue.
      if (e instanceof DriveScopeError) throw e
      // Transient errors (network, 5xx) — leave this one queued and retry
      // on the next drain pass.
    }
  }
}
