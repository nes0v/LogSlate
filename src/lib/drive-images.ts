// Trade-screenshot storage in the user's Google Drive.
//
// The `screenshot` field on a TradeRecord is a reference string:
//   null             — no screenshot
//   'drive:{id}'     — lives in the user's Drive, fileId = {id}
//   'pending:{id}'   — local-only blob waiting to be uploaded on next online sync
//
// Uploads happen immediately when online; when offline, the blob is stashed in
// the `pending_uploads` IndexedDB table with a temp id and the trade's
// screenshot field is set to `pending:{tempId}`. A separate drain pass
// (wired into auto-sync) uploads pending blobs and rewrites the reference.

import { db } from '@/db/schema'
import {
  createDriveFolder,
  downloadDriveFile,
  driveFileExists,
  driveViewLink,
  findDriveFolder,
  uploadDriveFile,
} from '@/lib/drive'
import { getDriveState } from '@/lib/drive'

const FOLDER_NAME = 'LogSlate screenshots'
const FOLDER_ID_KEY = 'logslate:drive:screenshots_folder'

function loadCachedFolderId(): string | null {
  try {
    return localStorage.getItem(FOLDER_ID_KEY)
  } catch {
    return null
  }
}

function saveCachedFolderId(id: string | null): void {
  try {
    if (id) localStorage.setItem(FOLDER_ID_KEY, id)
    else localStorage.removeItem(FOLDER_ID_KEY)
  } catch {
    // localStorage unavailable — we'll find the folder again next time.
  }
}

let folderIdPromise: Promise<string> | null = null

export async function getOrCreateScreenshotsFolder(): Promise<string> {
  if (folderIdPromise) return folderIdPromise
  folderIdPromise = (async () => {
    const cached = loadCachedFolderId()
    if (cached) {
      try {
        if (await driveFileExists(cached)) return cached
      } catch {
        // Treat any error as "cache is stale"; fall through to re-find.
      }
      saveCachedFolderId(null)
    }
    const existing = await findDriveFolder(FOLDER_NAME)
    if (existing) {
      saveCachedFolderId(existing)
      return existing
    }
    const created = await createDriveFolder(FOLDER_NAME)
    saveCachedFolderId(created)
    return created
  })()
  try {
    return await folderIdPromise
  } catch (e) {
    folderIdPromise = null
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

function uploadFilename(blob: Blob): string {
  const ext = blob.type?.split('/')[1]?.toLowerCase() || 'bin'
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'bin'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `screenshot-${stamp}-${newId().slice(0, 8)}.${safeExt}`
}

// Upload directly to Drive, return the reference string.
async function uploadDirectly(blob: Blob): Promise<string> {
  const folderId = await getOrCreateScreenshotsFolder()
  const { id } = await uploadDriveFile({
    name: uploadFilename(blob),
    body: blob,
    parentId: folderId,
  })
  return `drive:${id}`
}

async function enqueuePending(blob: Blob): Promise<string> {
  const id = newId()
  const now = new Date().toISOString()
  await db.pending_uploads.add({ id, blob, created_at: now })
  return `pending:${id}`
}

// Called by the trade form when the user picks a screenshot. Returns the
// reference string to store on the trade record. Uploads immediately when
// possible; falls back to the pending queue otherwise.
export async function storeScreenshot(blob: Blob): Promise<string> {
  if (!canUploadToDrive()) return enqueuePending(blob)
  try {
    return await uploadDirectly(blob)
  } catch {
    // Network blip, scope not granted, etc. — queue it and let the drainer
    // retry later instead of losing the image.
    return enqueuePending(blob)
  }
}

// Best-effort: remove the underlying blob when a screenshot is detached. For
// Drive refs, delete the Drive file; for pending refs, drop the queued blob.
// Failures are swallowed — the image field on the trade is what the user sees.
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
  // Don't delete Drive files automatically — the user might want to keep them
  // even if they remove from a trade. If desired, we can add a cleanup action
  // later.
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

export async function resolveScreenshotUrl(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null
  const cached = urlCache.get(raw)
  if (cached) return cached
  const ref = parseScreenshotRef(raw)
  if (!ref) return null
  try {
    const blob =
      ref.kind === 'pending' ? await blobForPending(ref.pendingId) : await blobForDrive(ref.fileId)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    rememberUrl(raw, url)
    return url
  } catch {
    return null
  }
}

// --- queue drain (called from auto-sync when online + signed-in) ---

export async function drainPendingUploads(): Promise<void> {
  if (!canUploadToDrive()) return
  const pending = await db.pending_uploads.toArray()
  for (const p of pending) {
    try {
      const folderId = await getOrCreateScreenshotsFolder()
      const { id: driveId } = await uploadDriveFile({
        name: uploadFilename(p.blob),
        body: p.blob,
        parentId: folderId,
      })
      const oldRef = `pending:${p.id}`
      const newRef = `drive:${driveId}`
      // Rewrite any trade records that pointed at this pending id. We scan
      // the whole trades table because account scoping doesn't help here
      // (the same blob ref is unique anyway).
      await db.transaction('rw', db.trades, db.pending_uploads, async () => {
        const now = new Date().toISOString()
        const affected = await db.trades.where('screenshot').equals(oldRef).toArray()
        for (const t of affected) {
          await db.trades.update(t.id, { screenshot: newRef, updated_at: now })
        }
        await db.pending_uploads.delete(p.id)
      })
      // Move the cached URL over to the new ref so the UI doesn't re-fetch.
      const cachedUrl = urlCache.get(oldRef)
      if (cachedUrl) {
        urlCache.delete(oldRef)
        rememberUrl(newRef, cachedUrl)
      }
    } catch {
      // Leave this one in the queue and try again on the next drain.
    }
  }
}
