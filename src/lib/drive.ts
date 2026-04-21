// Google Drive sync using Google Identity Services (GIS) token flow.
//
// Scope: https://www.googleapis.com/auth/drive.appdata — the app can only see
// its own private folder in the user's Drive (invisible from the Drive UI),
// never the user's other files. Revocable via https://myaccount.google.com/
//
// State is exposed as an external store so components can subscribe via
// useSyncExternalStore. All mutations go through `update()` to notify subscribers.

import { useSyncExternalStore } from 'react'

export type DriveStatus = 'signed-out' | 'signing-in' | 'signed-in' | 'error'

export interface DriveState {
  status: DriveStatus
  error: string | null
  userEmail: string | null // best-effort (we don't request profile scope, so this stays null)
}

// Two scopes:
// - drive.appdata lets us keep the sync file in a hidden per-app folder.
// - drive.file lets us create a user-visible "LogSlate screenshots" folder
//   where trade screenshots live, so the user can browse them in Drive.
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const TOKEN_KEY = 'logslate:drive:token'

interface StoredToken {
  value: string
  expiresAt: number // epoch ms
}

function loadToken(): StoredToken | null {
  try {
    const s = localStorage.getItem(TOKEN_KEY)
    if (!s) return null
    const t = JSON.parse(s) as StoredToken
    if (!t || typeof t.value !== 'string' || typeof t.expiresAt !== 'number') return null
    return t
  } catch {
    return null
  }
}

function saveToken(t: StoredToken | null) {
  if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
  else localStorage.removeItem(TOKEN_KEY)
}

// ---------- external store ----------

let state: DriveState = {
  status: loadToken() && loadToken()!.expiresAt > Date.now() + 30_000 ? 'signed-in' : 'signed-out',
  error: null,
  userEmail: null,
}

const listeners = new Set<() => void>()

export function subscribeDrive(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getDriveState(): DriveState {
  return state
}

function update(patch: Partial<DriveState>): void {
  // Create a new object so useSyncExternalStore detects the change via
  // reference equality — mutating in place would leave getSnapshot() returning
  // the same reference and React would skip the re-render.
  state = { ...state, ...patch }
  listeners.forEach(fn => fn())
}

export function useDriveState(): DriveState {
  return useSyncExternalStore(subscribeDrive, getDriveState, getDriveState)
}

// ---------- GIS loading ----------

let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    if (existing) {
      if (window.google) resolve()
      else existing.addEventListener('load', () => resolve())
      return
    }
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisPromise
}

function getClientId(): string | null {
  const id = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
  return id || null
}

export function isConfigured(): boolean {
  return getClientId() !== null
}

// Google's `expires_in` is seconds. Some responses omit it or return a value
// we can't trust — clamp to a sane window so we don't end up with a token
// that's instantly "expired" (re-auth loop) or absurdly long-lived.
const MIN_EXPIRES_SEC = 60
const MAX_EXPIRES_SEC = 86_400

export function parseExpiresIn(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(n) || n <= 0) return 3600
  return Math.min(Math.max(n, MIN_EXPIRES_SEC), MAX_EXPIRES_SEC)
}

interface RequestTokenOpts {
  prompt: '' | 'none' | 'consent'
  // When true, drive state is left alone on failure — the caller wants to
  // refresh in the background without visibly disconnecting the user.
  silent: boolean
}

function requestToken(opts: RequestTokenOpts): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const clientId = getClientId()
    if (!clientId) {
      reject(new Error('VITE_GOOGLE_CLIENT_ID is not set'))
      return
    }
    if (!window.google) {
      reject(new Error('Google Identity Services not loaded'))
      return
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: resp => {
        if (resp.error || !resp.access_token) {
          if (!opts.silent) {
            update({ status: 'error', error: resp.error ?? 'no access token' })
          }
          reject(new Error(resp.error ?? 'auth failed'))
          return
        }
        const expiresInSec = parseExpiresIn(resp.expires_in)
        saveToken({ value: resp.access_token, expiresAt: Date.now() + expiresInSec * 1000 })
        if (!opts.silent) {
          update({ status: 'signed-in', error: null })
        }
        resolve(resp.access_token)
      },
      error_callback: err => {
        const type = String((err as { type?: string })?.type ?? 'auth error')
        if (!opts.silent) {
          update({ status: 'error', error: type })
        }
        // Reject the promise so callers can recover instead of hanging.
        reject(new Error(type))
      },
    })
    client.requestAccessToken({ prompt: opts.prompt })
  })
}

// ---------- sign in / sign out ----------

export async function signIn(): Promise<void> {
  update({ status: 'signing-in', error: null })
  try {
    await loadGis()
    await requestToken({ prompt: '', silent: false })
  } catch (e) {
    // requestToken already updated state to 'error'; rethrow for callers.
    throw e instanceof Error ? e : new Error(String(e))
  }
}

export function signOut(): void {
  const t = loadToken()
  saveToken(null)
  update({ status: 'signed-out', error: null })
  if (t?.value && window.google) {
    window.google.accounts.oauth2.revoke(t.value, () => {})
  }
}

// Silent token refresh for background sync. Keeps drive.status at 'signed-in'
// throughout so the UI doesn't flash "disconnected" on every hourly refresh.
// If GIS can't refresh without user interaction (cookies blocked, session
// lost, consent needed), this rejects and the caller surfaces a sync error
// — the user can re-connect manually via Settings.
//
// Concurrent callers share a single in-flight refresh — otherwise when two
// parallel API calls hit an expired token they each fire their own GIS
// refresh, and Google will reject one, leaving that caller with a spurious
// "Couldn't load" error even though nothing's wrong with the resource.
let inFlightRefresh: Promise<string> | null = null

async function refreshTokenSilently(): Promise<string> {
  if (inFlightRefresh) return inFlightRefresh
  inFlightRefresh = (async () => {
    await loadGis()
    return requestToken({ prompt: 'none', silent: true })
  })()
  try {
    return await inFlightRefresh
  } finally {
    inFlightRefresh = null
  }
}

async function getValidTokenForBackground(): Promise<string> {
  const t = loadToken()
  if (t && t.expiresAt > Date.now() + 30_000) return t.value
  return refreshTokenSilently()
}

// On app boot, if a stored token exists but has expired, try once to silently
// refresh it — the user's Google session + prior consent are usually still
// valid for days, so we shouldn't force them to click "Connect" every time
// they reopen the tab. On success: status flips to 'signed-in' and auto-sync
// picks it up. On failure: the token is cleared so we don't keep retrying.
export async function tryRestoreSession(): Promise<void> {
  const t = loadToken()
  if (!t) return
  if (t.expiresAt > Date.now() + 30_000) return // already valid, nothing to do
  try {
    await refreshTokenSilently()
    update({ status: 'signed-in', error: null })
  } catch {
    saveToken(null)
    update({ status: 'signed-out', error: null })
  }
}

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getValidTokenForBackground()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const resp = await fetch(url, { ...init, headers })
  if (resp.status !== 401) return resp
  // Token rejected — drop and try one silent refresh.
  saveToken(null)
  const token2 = await refreshTokenSilently()
  const headers2 = new Headers(init?.headers)
  headers2.set('Authorization', `Bearer ${token2}`)
  return fetch(url, { ...init, headers: headers2 })
}

// ---------- Drive API helpers (appDataFolder scoped) ----------

export interface DriveFileMeta {
  id: string
  name: string
  modifiedTime: string
}

export async function findAppDataFile(name: string): Promise<DriveFileMeta | null> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('spaces', 'appDataFolder')
  url.searchParams.set('q', `name = '${name.replace(/'/g, "\\'")}' and trashed = false`)
  url.searchParams.set('fields', 'files(id,name,modifiedTime)')
  const resp = await authFetch(url.toString())
  if (!resp.ok) throw new Error(`Drive list failed: ${resp.status}`)
  const body = (await resp.json()) as { files?: DriveFileMeta[] }
  const file = body.files?.[0]
  return file ?? null
}

export async function downloadAppDataFile(id: string): Promise<string> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`
  const resp = await authFetch(url)
  if (!resp.ok) throw new Error(`Drive download failed: ${resp.status}`)
  return resp.text()
}

// ---------- Generic Drive helpers (scope: drive.file) ----------
//
// These operate on files/folders the app created in the user's main Drive.
// Screenshots live here so the user can browse them manually.

// Raised when a Drive call 403s because the current token doesn't hold the
// scope we asked for. Happens after we add a new scope to SCOPE: existing
// tokens only carry the scopes they were minted with, and silent refresh
// reuses that set — so the user has to Disconnect + Connect once to
// re-consent. The UI surfaces this differently from generic errors.
export class DriveScopeError extends Error {
  constructor(message = 'Drive access is missing the screenshot folder scope. Disconnect and reconnect in Settings to re-grant access.') {
    super(message)
    this.name = 'DriveScopeError'
  }
}

function throwForStatus(resp: Response, context: string): never {
  if (resp.status === 403) throw new DriveScopeError()
  throw new Error(`${context}: ${resp.status}`)
}

export async function findDriveFolder(name: string, parentId?: string): Promise<string | null> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  const parts = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    `trashed = false`,
  ]
  if (parentId) parts.push(`'${parentId.replace(/'/g, "\\'")}' in parents`)
  url.searchParams.set('q', parts.join(' and '))
  url.searchParams.set('fields', 'files(id)')
  const resp = await authFetch(url.toString())
  if (!resp.ok) throwForStatus(resp, 'Drive folder search failed')
  const body = (await resp.json()) as { files?: Array<{ id: string }> }
  return body.files?.[0]?.id ?? null
}

export async function createDriveFolder(name: string, parentId?: string): Promise<string> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  }
  if (parentId) metadata.parents = [parentId]
  const resp = await authFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  if (!resp.ok) throwForStatus(resp, 'Drive folder create failed')
  const body = (await resp.json()) as { id: string }
  return body.id
}

export async function driveFileExists(id: string): Promise<boolean> {
  const resp = await authFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,trashed`,
  )
  if (resp.status === 404) return false
  if (!resp.ok) throw new Error(`Drive file check failed: ${resp.status}`)
  const body = (await resp.json()) as { trashed?: boolean }
  return body.trashed !== true
}

export async function uploadDriveFile(opts: {
  name: string
  body: Blob
  parentId?: string
}): Promise<{ id: string }> {
  // Multipart upload with metadata + binary body in one request.
  const boundary = `-------logslate-${crypto.randomUUID()}`
  const metadata: Record<string, unknown> = { name: opts.name }
  if (opts.parentId) metadata.parents = [opts.parentId]
  const bodyBytes = new Uint8Array(await opts.body.arrayBuffer())
  const enc = new TextEncoder()
  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${opts.body.type || 'application/octet-stream'}\r\n\r\n`,
  )
  const tail = enc.encode(`\r\n--${boundary}--`)
  const combined = new Uint8Array(head.length + bodyBytes.length + tail.length)
  combined.set(head, 0)
  combined.set(bodyBytes, head.length)
  combined.set(tail, head.length + bodyBytes.length)
  const resp = await authFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: combined,
    },
  )
  if (!resp.ok) {
    if (resp.status === 403) throw new DriveScopeError()
    throw new Error(`Drive upload failed: ${resp.status} ${await resp.text()}`)
  }
  return (await resp.json()) as { id: string }
}

export async function downloadDriveFile(id: string): Promise<Blob> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`
  const resp = await authFetch(url)
  if (!resp.ok) throwForStatus(resp, 'Drive download failed')
  return resp.blob()
}

export async function deleteDriveFile(id: string): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`
  const resp = await authFetch(url, { method: 'DELETE' })
  // 404 = already gone, treat as success.
  if (!resp.ok && resp.status !== 404) throwForStatus(resp, 'Drive delete failed')
}

export function driveViewLink(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
}

export async function uploadAppDataFile(opts: {
  id?: string
  name: string
  body: string
}): Promise<DriveFileMeta> {
  const boundary = `-------logslate-${crypto.randomUUID()}`
  const metadata: Record<string, unknown> = { name: opts.name }
  if (!opts.id) metadata.parents = ['appDataFolder']
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${opts.body}\r\n` +
    `--${boundary}--`

  const base = 'https://www.googleapis.com/upload/drive/v3/files'
  const url = opts.id
    ? `${base}/${encodeURIComponent(opts.id)}?uploadType=multipart&fields=id,name,modifiedTime`
    : `${base}?uploadType=multipart&fields=id,name,modifiedTime`

  const resp = await authFetch(url, {
    method: opts.id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  })
  if (!resp.ok) throw new Error(`Drive upload failed: ${resp.status} ${await resp.text()}`)
  return (await resp.json()) as DriveFileMeta
}
