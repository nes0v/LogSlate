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

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
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
async function refreshTokenSilently(): Promise<string> {
  await loadGis()
  return requestToken({ prompt: 'none', silent: true })
}

async function getValidTokenForBackground(): Promise<string> {
  const t = loadToken()
  if (t && t.expiresAt > Date.now() + 30_000) return t.value
  return refreshTokenSilently()
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
