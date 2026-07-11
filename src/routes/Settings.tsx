import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CheckCircle2, CloudDownload, CloudUpload, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { clearAutoSyncState, requestManualSync, useAutoSyncState } from '@/lib/auto-sync'
import { listAccounts, listAdjustments } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { isConfigured, revalidateDriveToken, signIn, signOut, useDriveState } from '@/lib/drive'
import { lastSyncAt } from '@/lib/sync'
import { exportBackup, importBackup } from '@/lib/backup'
import { AccountsPanel } from '@/components/AccountsPanel'
import { AdjustmentsPanel } from '@/components/AdjustmentsPanel'
import { BTN_ACCENT, BTN_OUTLINED } from '@/components/form/buttonClass'
import { Pills } from '@/components/form/Pills'
import { setDefaultRangeMonths, useDefaultRangeMonths, type DefaultRangeMonths } from '@/lib/default-range-preference'
import { cn, errorMessage } from '@/lib/utils'

export function SettingsRoute() {
  const drive = useDriveState()
  const configured = isConfigured()
  // Surfaced from the sync engine so the spinner/summary keep working
  // even though sync is now manual-only.
  const autoSync = useAutoSyncState()
  const syncing = autoSync.status === 'syncing'
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // A token can lapse on the clock while the tab sits open, leaving the drive
  // state stuck on 'signed-in' ("Sync now" shows but every call 401s). Re-check
  // expiry each time Settings opens so the UI drops to "Connect" up front.
  useEffect(() => {
    revalidateDriveToken()
  }, [])

  // Drive the page-level loaded gate so the whole Settings body reveals
  // at once. Panels keep their own internal queries (Dexie de-duplicates
  // so the cost is negligible); this just blocks paint until the data
  // they need is available.
  const accountId = useActiveAccountId()
  const accounts = useLiveQuery(() => listAccounts(), [])
  const adjustments = useLiveQuery(() => listAdjustments(accountId), [accountId])
  const loaded = accounts !== undefined && adjustments !== undefined

  async function handleSync() {
    await requestManualSync()
  }

  /** Confirms the file-gone recovery — pushes local data into a fresh
   *  Drive file. Safe (no data loss): the merge is forced to keep all
   *  local rows since `lastSyncedIds` is treated as empty for this run. */
  async function handleRecreateRemote() {
    await requestManualSync({ recreateRemoteIfMissing: true })
  }

  /** Confirms the corrupt-file recovery — overwrites the unparseable
   *  Drive file with local data. Destructive on the Drive side (the
   *  corrupted bytes are gone for good), so the action is gated behind
   *  an explicit click and a confirm() dialog. */
  async function handleOverwriteCorruptRemote() {
    const ok = window.confirm(
      "Overwrite the corrupted Drive file with your local data? " +
      "Whatever the corrupted file contained will be lost — but your " +
      "local trades, models, and settings will be preserved.",
    )
    if (!ok) return
    await requestManualSync({ overwriteCorruptRemote: true })
  }

  async function handleSignOut() {
    signOut()
    // Intentionally NOT calling `clearSyncState()` — wiping `lastSyncedIds`
    // here would (a) resurrect any rows the user deleted between this
    // sign-out and the next sign-in (the merge can no longer tell deletion
    // from creation) and (b) leak this account's data into another
    // account's Drive file if the user signs into a different Google
    // account next. The id sets are harmless to keep across sign-outs:
    // same account → deletes propagate correctly; different account →
    // local rows look like remote-side deletions and get cleanly wiped
    // when the new account's data is pulled in.
    clearAutoSyncState()
  }

  async function handleImport(file: File) {
    if (importing) return
    setImporting(true)
    try {
      const r = await importBackup(file)
      const summary = Object.entries(r)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${n} ${name}`)
        .join(', ')
      alert(`Imported ${summary || 'nothing'}. Local DB replaced.`)
    } catch (e) {
      alert(`Import failed: ${errorMessage(e)}`)
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
                  <button
                    onClick={handleSignOut}
                    className={cn(BTN_OUTLINED, 'hover:text-(--color-loss)')}
                  >
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
                      className={BTN_ACCENT}
                    >
                      <RefreshCw className={'size-4 ' + (syncing ? 'animate-spin' : '')} />
                      {syncing ? 'Syncing…' : 'Sync now'}
                    </button>
                  </div>

                  {autoSync.lastResult && !autoSync.error && (
                    <div className="text-xs text-(--color-text-dim) font-mono space-y-0.5">
                      {Object.entries(autoSync.lastResult.perTable).map(([name, c]) => (
                        <div key={name}>
                          {name}: merged {c.merged} · local {c.local} · remote {c.remote}
                        </div>
                      ))}
                      <div>
                        {autoSync.lastResult.createdRemote ? 'created remote file · ' : ''}
                        {autoSync.lastResult.skippedPush ? 'skipped push (no changes)' : ''}
                      </div>
                    </div>
                  )}

                  {autoSync.errorKind === 'account-mismatch' ? (
                    <div className="rounded-(--radius) border border-(--color-loss)/40 bg-(--color-loss)/10 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="size-4 text-(--color-loss) mt-0.5 shrink-0" />
                        <div className="text-sm space-y-1">
                          <div className="font-medium text-(--color-loss)">Wrong Google account</div>
                          <div className="text-(--color-text-dim)">{autoSync.error}</div>
                          <div className="text-(--color-text-dim)">
                            Sync is blocked to prevent overwriting your local data. Export a backup first if you need to switch accounts.
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button onClick={exportBackup} className={BTN_OUTLINED}>
                          <CloudDownload className="size-4" /> Export backup
                        </button>
                        <button
                          onClick={handleSignOut}
                          className={cn(BTN_OUTLINED, 'hover:text-(--color-loss)')}
                        >
                          <LogOut className="size-4" /> Disconnect
                        </button>
                      </div>
                    </div>
                  ) : autoSync.errorKind === 'file-gone' ? (
                    <div className="rounded-(--radius) border border-(--color-warn)/40 bg-(--color-warn)/10 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="size-4 text-(--color-warn) mt-0.5 shrink-0" />
                        <div className="text-sm space-y-1">
                          <div className="font-medium text-(--color-warn)">Drive file missing</div>
                          <div className="text-(--color-text-dim)">{autoSync.error}</div>
                        </div>
                      </div>
                      <div className="pt-1">
                        <button
                          onClick={handleRecreateRemote}
                          disabled={syncing}
                          className={BTN_ACCENT}
                        >
                          <RefreshCw className={'size-4 ' + (syncing ? 'animate-spin' : '')} />
                          Recreate file from local data
                        </button>
                      </div>
                    </div>
                  ) : autoSync.errorKind === 'file-corrupt' ? (
                    <div className="rounded-(--radius) border border-(--color-warn)/40 bg-(--color-warn)/10 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="size-4 text-(--color-warn) mt-0.5 shrink-0" />
                        <div className="text-sm space-y-1">
                          <div className="font-medium text-(--color-warn)">Drive file corrupted</div>
                          <div className="text-(--color-text-dim)">{autoSync.error}</div>
                        </div>
                      </div>
                      <div className="pt-1">
                        <button
                          onClick={handleOverwriteCorruptRemote}
                          disabled={syncing}
                          className={BTN_ACCENT}
                        >
                          <RefreshCw className={'size-4 ' + (syncing ? 'animate-spin' : '')} />
                          Overwrite Drive file with local data
                        </button>
                      </div>
                    </div>
                  ) : autoSync.errorKind === 'file-version' ? (
                    <div className="rounded-(--radius) border border-(--color-warn)/40 bg-(--color-warn)/10 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="size-4 text-(--color-warn) mt-0.5 shrink-0" />
                        <div className="text-sm space-y-1">
                          <div className="font-medium text-(--color-warn)">App update required</div>
                          <div className="text-(--color-text-dim)">{autoSync.error}</div>
                        </div>
                      </div>
                      <div className="pt-1">
                        <button
                          onClick={() => window.location.reload()}
                          className={BTN_ACCENT}
                        >
                          <RefreshCw className="size-4" />
                          Reload to update
                        </button>
                      </div>
                    </div>
                  ) : autoSync.error ? (
                    <div className="text-sm text-(--color-loss)">Sync error: {autoSync.error}</div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <AccountsPanel accounts={accounts} />

      <AdjustmentsPanel adjustments={adjustments} />

      <DefaultRangeSection />

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

const RANGE_OPTIONS: ReadonlyArray<{ value: DefaultRangeMonths; label: string }> = [
  { value: 1, label: '1 month' },
  { value: 2, label: '2 months' },
  { value: 3, label: '3 months' },
]

function DefaultRangeSection() {
  const months = useDefaultRangeMonths()
  return (
    <section>
      <h2 className="text-sm font-medium mb-2">Default date range</h2>
      <div className="rounded-(--radius) bg-(--color-panel) p-3 space-y-3">
        <p className="text-sm text-(--color-text-dim)">
          How far back Overview and Reports default to when no date filter is set.
        </p>
        <Pills
          value={months}
          options={RANGE_OPTIONS}
          onChange={setDefaultRangeMonths}
        />
      </div>
    </section>
  )
}
