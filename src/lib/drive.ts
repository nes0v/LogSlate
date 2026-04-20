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

let tokenClient: TokenClient | null = null

function getClientId(): string | null {
  const id = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
  return id || null
}

export function isConfigured(): boolean {
  return getClientId() !== null
}

function ensureTokenClient(onToken: (t: TokenResponse) => void): TokenClient {
  const clientId = getClientId()
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set')
  if (!window.google) throw new Error('Google Identity Services not loaded')
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: onToken,
    error_callback: err => {
      update({ status: 'error', error: String((err as { type?: string })?.type ?? 'auth error') })
    },
  })
  return tokenClient
}

// ---------- sign in / sign out ----------

export async function signIn(): Promise<void> {
  update({ status: 'signing-in', error: null })
  try {
    await loadGis()
    await new Promise<void>((resolve, reject) => {
      const client = ensureTokenClient(resp => {
        if (resp.error || !resp.access_token) {
          update({ status: 'error', error: resp.error ?? 'no access token' })
          reject(new Error(resp.error ?? 'auth failed'))
          return
        }
        const expiresInSec = typeof resp.expires_in === 'string' ? Number(resp.expires_in) : (resp.expires_in ?? 3600)
        const tok: StoredToken = { value: resp.access_token, expiresAt: Date.now() + expiresInSec * 1000 }
        saveToken(tok)
        update({ status: 'signed-in', error: null })
        resolve()
      })
      client.requestAccessToken({ prompt: '' })
    })
  } catch (e) {
    update({ status: 'error', error: String((e as Error).message ?? e) })
    throw e
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

async function getValidToken(): Promise<string> {
  const t = loadToken()
  if (t && t.expiresAt > Date.now() + 30_000) return t.value
  // Token expired or missing — re-auth silently.
  await signIn()
  const t2 = loadToken()
  if (!t2) throw new Error('sign-in did not yield a token')
  return t2.value
}

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getValidToken()
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const resp = await fetch(url, { ...init, headers })
  if (resp.status === 401) {
    // Token rejected — drop and retry once.
    saveToken(null)
    const token2 = await getValidToken()
    const headers2 = new Headers(init?.headers)
    headers2.set('Authorization', `Bearer ${token2}`)
    return fetch(url, { ...init, headers: headers2 })
  }
  return resp
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
