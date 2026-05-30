// Day screenshot storage in the user's Google Drive.
//
// Each ref on a Day row is a string:
//   'drive:{id}'     — lives in the user's Drive, fileId = {id}
//   'pending:{id}'   — local-only blob waiting to be uploaded on next online sync
//
// Files are organised per account, by month:
//
//   LogSlate/
//     {accountName}/           ← cached by account id, not name (safe on rename)
//       YYYY-MM/
//         17-apr-2026-fri-01.png
//
// Filenames are built at enqueue time from a caller-supplied date and suffix
// so they're human-readable when the user browses the folder in Drive.
//
// Uploads happen immediately when online; when offline (or before the user
// triggers a manual sync), the blob is stashed in the `pending_uploads`
// IndexedDB table along with its account, precomputed filename and
// month_key, and the day row's screenshots[] entry is set to `pending:{id}`.
// `drainPendingUploads` runs at the start of every manual sync, uploading
// pending blobs into their owning account's folder and rewriting the
// reference to `drive:{id}`.

import { db } from '@/db/schema'
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
import { loadJsonFromStorage, removeFromStorage, saveJsonToStorage } from '@/lib/storage'

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

interface CachedAccountFolder {
  id: string
  name: string
}

function loadCachedAccountFolder(accountId: string): CachedAccountFolder | null {
  // Back-compat: old cache stored the bare id string — has to be sniffed
  // before JSON.parse, so this one can't use loadJsonFromStorage.
  try {
    const raw = localStorage.getItem(accountFolderKey(accountId))
    if (!raw) return null
    if (!raw.startsWith('{')) return { id: raw, name: '' }
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { id?: unknown }).id === 'string' &&
      typeof (parsed as { name?: unknown }).name === 'string'
    ) {
      return parsed as CachedAccountFolder
    }
    return null
  } catch {
    return null
  }
}

function saveCachedAccountFolder(
  accountId: string,
  entry: CachedAccountFolder | null,
): void {
  const key = accountFolderKey(accountId)
  if (entry) saveJsonToStorage(key, entry)
  else removeFromStorage(key)
}

function loadMonthFolderMap(accountId: string): Record<string, string> {
  return loadJsonFromStorage(
    monthFolderMapKey(accountId),
    raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    },
    {} as Record<string, string>,
  )
}

function saveMonthFolderMap(accountId: string, map: Record<string, string>): void {
  saveJsonToStorage(monthFolderMapKey(accountId), map)
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
    const name = await accountFolderName(accountId)
    const cached = loadCachedAccountFolder(accountId)
    // Cache hit only when both the id is still alive AND the cached folder
    // name matches the current account name. Renaming an account would
    // otherwise route uploads to the old folder forever.
    if (cached && cached.name === name) {
      try {
        if (await driveFileExists(cached.id)) return cached.id
      } catch {
        // Treat any error as "cache is stale"; fall through to re-find.
      }
    }
    saveCachedAccountFolder(accountId, null)
    const topId = await getOrCreateTopFolder()
    const existing = await findDriveFolder(name, topId)
    if (existing) {
      saveCachedAccountFolder(accountId, { id: existing, name })
      return existing
    }
    const created = await createDriveFolder(name, topId)
    saveCachedAccountFolder(accountId, { id: created, name })
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

// YYYY-MM-DD + "fri-01" + "png" → "17-apr-2026-fri-01.png".
export function buildFilename(date: string, suffix: string, ext: string): string {
  const [y, m, d] = date.split('-')
  const mi = Number(m) - 1
  const mon = mi >= 0 && mi < 12 ? MONTH_ABBR[mi] : m
  const safeSuffix = suffix.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'screenshot'
  return `${d}-${mon}-${y}-${safeSuffix}.${ext}`
}

const WEEKDAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

// "2026-05-18" + 1 → "mon-01" — the filename suffix for the Nth day-level
// screenshot. Derives the weekday from the date string directly (no
// timezone math: YYYY-MM-DD is a wall-clock day, and `Date.UTC` keeps the
// weekday calc stable across browser TZs).
export function dayScreenshotSuffix(date: string, ordinal: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAY_ABBR[wd]}-${String(ordinal).padStart(2, '0')}`
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
  // blips). Decode here too so the cache carries natural dims for layout
  // reservation downstream.
  rememberUrl(ref, await buildCacheEntry(blob))
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
  rememberUrl(ref, await buildCacheEntry(blob))
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

// Best-effort: free the underlying blob when a day-screenshot ref is
// removed. For Drive refs, delete the Drive file so the folder doesn't
// keep orphans the user can never reach again. For pending refs, drop
// the queued blob. Failures are swallowed — the Day row is the source
// of truth for the user.
export async function discardScreenshotRef(raw: string): Promise<void> {
  const ref = parseScreenshotRef(raw)
  if (!ref) return
  revokeCached(raw)
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
// Bounded LRU cache mapping a reference string to a blob URL + the
// decoded image's natural dimensions. Keeps repeated renders of the same
// screenshot (e.g. re-opening a day) from re-fetching. Evicted entries
// have their blob URLs revoked so long-lived sessions don't accumulate
// detached ObjectURLs.
//
// Dimensions are captured at every entry point that creates a blob URL
// (resolveScreenshotUrl, enqueuePending, uploadDirectly) by decoding the
// blob once with `img.decode()`. ScreenshotThumb then sets the cached
// `width`/`height` on the rendered `<img>` element so the browser
// reserves layout space at the correct dims before its own decode
// completes — without this, the img briefly renders at 0×0 while
// decoding, which visibly collapses the surrounding layout.
export interface CachedScreenshot {
  url: string
  width: number
  height: number
}
const MAX_CACHED_URLS = 24
const urlCache = new Map<string, CachedScreenshot>()

function revokeCached(ref: string): void {
  const existing = urlCache.get(ref)
  if (existing) {
    URL.revokeObjectURL(existing.url)
    urlCache.delete(ref)
  }
}

/** Synchronous lookup into the same module-level cache populated by
 *  `resolveScreenshotUrl`. Returns the blob URL + natural dims if a
 *  previous resolve has settled. Used by `ScreenshotThumb` to render
 *  the image at the correct size on the first frame after navigation
 *  when the cache is warm (e.g. seeded by `preloadDay`). */
export function getCachedScreenshotUrl(
  raw: string | null | undefined,
): CachedScreenshot | undefined {
  if (!raw) return undefined
  return urlCache.get(raw)
}

function rememberUrl(ref: string, entry: CachedScreenshot): void {
  if (urlCache.has(ref)) revokeCached(ref)
  urlCache.set(ref, entry)
  while (urlCache.size > MAX_CACHED_URLS) {
    const oldest = urlCache.keys().next().value
    if (oldest === undefined) break
    revokeCached(oldest)
  }
}

/** Creates a blob URL and runs `img.decode()` to capture the image's
 *  natural width/height. Returns the full cache entry shape. Used at
 *  every entry point that mints a fresh blob URL (resolve / upload /
 *  enqueue) so the cache always carries dims alongside the URL. */
async function buildCacheEntry(blob: Blob): Promise<CachedScreenshot> {
  const url = URL.createObjectURL(blob)
  let width = 0
  let height = 0
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    width = img.naturalWidth
    height = img.naturalHeight
  } catch {
    // Decode failure → leave dims at 0; the `<img>` element will render
    // at intrinsic size (same as the old "no-dims" behaviour) and the
    // surrounding layout briefly collapses. Acceptable fallback for
    // corrupt blobs.
  }
  return { url, width, height }
}

async function blobForPending(pendingId: string): Promise<Blob | null> {
  const rec = await db.pending_uploads.get(pendingId)
  return rec?.blob ?? null
}

async function blobForDrive(fileId: string): Promise<Blob> {
  return downloadDriveFile(fileId)
}

// Resolves a ref to a cache entry suitable for rendering. Throws on
// failure (missing pending blob, Drive fetch error, scope issue) so
// callers can surface a meaningful message — swallowing made "image
// won't load" bugs impossible to diagnose without devtools.
/** Per-ref resolution result: either a blob URL + dims ready for
 *  `<img>` or the error message from the failed fetch. */
export type ResolvedScreenshot =
  | { url: string; width: number; height: number }
  | { error: string }

export async function resolveScreenshotUrl(
  raw: string | null | undefined,
): Promise<CachedScreenshot> {
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
  // `buildCacheEntry` runs `img.decode()` so the consuming `<img>` paints
  // at its intrinsic dimensions in one frame. Without the decode, the
  // thumb's loader is replaced by an `<img>` that briefly renders at
  // 0×0 (then reflows once the browser finishes decoding) — a visible
  // "collapse then re-expand" layout shift.
  const entry = await buildCacheEntry(blob)
  rememberUrl(raw, entry)
  return entry
}

// --- queue drain (runs at the start of every manual sync) ---

export async function drainPendingUploads(): Promise<void> {
  if (!canUploadToDrive()) return
  const pending = await db.pending_uploads.toArray()
  for (const p of pending) {
    try {
      const folderId = await getOrCreateMonthFolder(p.account_id, p.month_key)
      const { id: driveId } = await uploadDriveFile({
        name: p.filename,
        body: p.blob,
        parentId: folderId,
      })
      const oldRef = `pending:${p.id}`
      const newRef = `drive:${driveId}`
      // Rewrite any day rows that pointed at this pending id. The URL cache
      // is transferred inside the transaction so it's already keyed under
      // `drive:` by the time Dexie fires its post-commit live-query
      // notifications — otherwise a thumb could re-mount on the new ref
      // before the cache entry exists and do a redundant re-fetch.
      await db.transaction(
        'rw',
        db.days,
        db.pending_uploads,
        async () => {
          const now = new Date().toISOString()
          // `*screenshots` is multi-entry indexed, so this returns any day
          // whose array contains the pending ref.
          const affectedDays = await db.days
            .where('screenshots')
            .equals(oldRef)
            .toArray()
          for (const d of affectedDays) {
            const screenshots = d.screenshots.map(s => (s === oldRef ? newRef : s))
            await db.days.update(d.id, { screenshots, updated_at: now })
          }
          await db.pending_uploads.delete(p.id)
          // Transfer the cached blob URL + dims from the pending entry
          // to a new entry under the Drive ref — same underlying Blob,
          // just a new key. Done synchronously inside the transaction
          // callback so it lands before commit.
          const cachedEntry = urlCache.get(oldRef)
          if (cachedEntry) {
            urlCache.delete(oldRef)
            rememberUrl(newRef, cachedEntry)
          }
        },
      )
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

