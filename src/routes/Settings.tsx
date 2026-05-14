import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, CloudDownload, CloudUpload, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { requestManualSync } from '@/lib/auto-sync'
import { listAccounts, listAdjustments } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { isConfigured, signIn, signOut, useDriveState } from '@/lib/drive'
import { clearSyncState, lastSyncAt, type SyncResult } from '@/lib/sync'
import { exportBackup, importBackup } from '@/lib/backup'
import { AccountsPanel } from '@/components/AccountsPanel'
import { AdjustmentsPanel } from '@/components/AdjustmentsPanel'
import { BTN_ACCENT, BTN_OUTLINED } from '@/components/form/buttonClass'
import { cn, errorMessage } from '@/lib/utils'

export function SettingsRoute() {
  const drive = useDriveState()
  const configured = isConfigured()
  const [syncing, setSyncing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Drive the page-level loaded gate so the whole Settings body reveals
  // at once. Panels keep their own internal queries (Dexie de-duplicates
  // so the cost is negligible); this just blocks paint until the data
  // they need is available.
  const accountId = useActiveAccountId()
  const accounts = useLiveQuery(() => listAccounts(), [])
  const adjustments = useLiveQuery(() => listAdjustments(accountId), [accountId])
  const loaded = accounts !== undefined && adjustments !== undefined

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const r = await requestManualSync()
      if (r) setLastResult(r)
      else setError('A sync is already running — try again in a moment.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSyncing(false)
    }
  }

  async function handleSignOut() {
    signOut()
    clearSyncState()
    setLastResult(null)
  }

  async function handleImport(file: File) {
    if (importing) return
    setImporting(true)
    try {
      const r = await importBackup(file)
      setError(null)
      setLastResult(null)
      const summary = Object.entries(r)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${n} ${name}`)
        .join(', ')
      alert(`Imported ${summary || 'nothing'}. Local DB replaced.`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setImporting(false)
    }
  }

  const lastAt = lastSyncAt()

  return (
    <div className="pt-1 space-y-8 max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Settings</h1>
      </div>

      {!loaded ? null : (
      <>
      <section>
        <h2 className="text-sm font-medium mb-2">Google Drive sync</h2>
        <div className="rounded-(--radius) bg-(--color-panel) p-3 space-y-3">
          <p className="text-sm text-(--color-text-dim)">
            Trades sync to a hidden file in your own Google Drive — only this app can read it.
            <br />
            Screenshots go into a visible folder per account, so you can browse them in Drive too.
          </p>

          {!configured && (
            <div className="rounded-(--radius) bg-(--color-panel-2) p-3 text-sm space-y-2">
              <p className="text-(--color-loss)">Google OAuth client ID is not configured.</p>
              <ol className="list-decimal list-inside space-y-1 text-(--color-text-dim)">
                <li>Go to Google Cloud Console → <em>APIs & Services → Credentials</em></li>
                <li>Create an OAuth client ID (type: <em>Web application</em>)</li>
                <li>Add <code className="bg-(--color-panel-2) px-1 rounded">http://localhost:5173</code> to Authorized JavaScript origins</li>
                <li>Copy the client ID into <code className="bg-(--color-panel-2) px-1 rounded">.env.local</code> as <code className="bg-(--color-panel-2) px-1 rounded">VITE_GOOGLE_CLIENT_ID=…</code></li>
                <li>Restart the dev server</li>
              </ol>
            </div>
          )}

          {configured && (
            <div className="rounded-(--radius) bg-(--color-panel-2) p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {drive.status === 'signed-in' ? (
                    <>
                      <CheckCircle2 className="size-4 text-(--color-win)" />
                      <span className="text-sm">Connected</span>
                    </>
                  ) : drive.status === 'signing-in' ? (
                    <>
                      <RefreshCw className="size-4 animate-spin text-(--color-text-dim)" />
                      <span className="text-sm">Signing in…</span>
                    </>
                  ) : (
                    <span className="text-sm text-(--color-text-dim)">Not connected</span>
                  )}
                </div>
                {drive.status === 'signed-in' ? (
                  <button onClick={handleSignOut} className={BTN_OUTLINED}>
                    <LogOut className="size-4" /> Disconnect
                  </button>
                ) : (
                  <button
                    onClick={signIn}
                    disabled={drive.status === 'signing-in'}
                    className={BTN_ACCENT}
                  >
                    <LogIn className="size-4" /> Connect Google Drive
                  </button>
                )}
              </div>

              {drive.error && (
                <div className="text-sm text-(--color-loss)">Auth error: {drive.error}</div>
              )}

              {drive.status === 'signed-in' && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-(--color-text-dim)">
                      {lastAt ? `Last sync ${formatDistanceToNow(lastAt, { addSuffix: true })}` : 'Never synced'}
                    </div>
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className={cn(BTN_OUTLINED, 'text-(--color-text) hover:bg-(--color-panel-2)')}
                    >
                      <RefreshCw className={'size-4 ' + (syncing ? 'animate-spin' : '')} />
                      {syncing ? 'Syncing…' : 'Sync now'}
                    </button>
                  </div>

                  {lastResult && !error && (
                    <div className="text-xs text-(--color-text-dim) font-mono space-y-0.5">
                      {Object.entries(lastResult.perTable).map(([name, c]) => (
                        <div key={name}>
                          {name}: merged {c.merged} · local {c.local} · remote {c.remote}
                        </div>
                      ))}
                      <div>
                        {lastResult.createdRemote ? 'created remote file · ' : ''}
                        {lastResult.skippedPush ? 'skipped push (no changes)' : ''}
                      </div>
                    </div>
                  )}
                  {error && <div className="text-sm text-(--color-loss)">Sync error: {error}</div>}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <AccountsPanel accounts={accounts} />

      <AdjustmentsPanel adjustments={adjustments} />

      <section>
        <h2 className="text-sm font-medium mb-2">Backup &amp; restore</h2>
        <div className="rounded-(--radius) bg-(--color-panel) p-3 space-y-3">
          <p className="text-sm text-(--color-text-dim)">
            Download a JSON file of everything.
            <br />
            Import will replace all local trades with the contents of a backup.
          </p>
          <div className="rounded-(--radius) bg-(--color-panel-2) p-3 flex items-center gap-2">
            <button onClick={exportBackup} className={BTN_ACCENT}>
              <CloudDownload className="size-4" /> Export
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className={BTN_ACCENT}
            >
              <CloudUpload className="size-4" /> {importing ? 'Importing…' : 'Import'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void handleImport(f)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </section>
      </>
      )}
    </div>
  )
}
