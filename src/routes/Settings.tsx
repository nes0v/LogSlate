import { useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2, CloudDownload, CloudUpload, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { isConfigured, signIn, signOut, useDriveState } from '@/lib/drive'
import { clearSyncState, lastSyncAt, syncNow, type SyncResult } from '@/lib/sync'
import { exportBackup, importBackup } from '@/lib/backup'
import { AccountsPanel } from '@/components/AccountsPanel'
import { EquityAdjustmentsPanel } from '@/components/EquityAdjustmentsPanel'

export function SettingsRoute() {
  const drive = useDriveState()
  const configured = isConfigured()
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const r = await syncNow()
      setLastResult(r)
    } catch (e) {
      setError((e as Error).message ?? String(e))
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
    try {
      const r = await importBackup(file)
      setError(null)
      setLastResult(null)
      alert(
        `Imported ${r.imported} trade${r.imported === 1 ? '' : 's'} and ${r.adjustments} adjustment${r.adjustments === 1 ? '' : 's'}. Local DB replaced.`,
      )
    } catch (e) {
      setError((e as Error).message ?? String(e))
    }
  }

  const lastAt = lastSyncAt()

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Google Drive sync</h2>
        <p className="text-sm text-(--color-text-dim)">
          Trades sync to a hidden file in your own Google Drive (app-specific folder —
          not visible in the Drive UI, only this app can read it). No server in the middle.
        </p>

        {!configured && (
          <div className="rounded-md border border-(--color-border) bg-(--color-panel) p-3 text-sm space-y-2">
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
          <div className="rounded-md border border-(--color-border) bg-(--color-panel) p-4 space-y-3">
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
                  <>
                    <span className="text-sm text-(--color-text-dim)">Not connected</span>
                  </>
                )}
              </div>
              {drive.status === 'signed-in' ? (
                <button
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
                >
                  <LogOut className="size-4" /> Disconnect
                </button>
              ) : (
                <button
                  onClick={signIn}
                  disabled={drive.status === 'signing-in'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-(--color-accent) text-white hover:opacity-90 disabled:opacity-50"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-(--color-border) text-(--color-text) hover:bg-(--color-panel-2) disabled:opacity-50"
                  >
                    <RefreshCw className={'size-4 ' + (syncing ? 'animate-spin' : '')} />
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                </div>

                {lastResult && !error && (
                  <div className="text-xs text-(--color-text-dim) font-mono space-y-0.5">
                    <div>
                      trades: merged {lastResult.mergedCount} · local {lastResult.localCount} · remote{' '}
                      {lastResult.remoteCount}
                    </div>
                    <div>
                      adjustments: merged {lastResult.mergedAdjustmentCount} · local{' '}
                      {lastResult.localAdjustmentCount} · remote {lastResult.remoteAdjustmentCount}
                    </div>
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
      </section>

      <AccountsPanel />

      <EquityAdjustmentsPanel />

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Backup &amp; restore</h2>
        <p className="text-sm text-(--color-text-dim)">
          Download a JSON file of everything. Import will replace all local trades with
          the contents of a backup.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={exportBackup}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-(--color-border) text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <CloudDownload className="size-4" /> Export JSON
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-(--color-border) text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <CloudUpload className="size-4" /> Import JSON
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
      </section>
    </div>
  )
}
