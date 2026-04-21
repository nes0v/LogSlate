import { Link } from 'react-router-dom'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useDriveState } from '@/lib/drive'
import { useAutoSyncState } from '@/lib/auto-sync'

// Renders only when something meaningful is happening — a spinner during a
// sync, or a red alert if the last sync errored. Clicking either jumps to
// Settings where the full sync status lives.
export function SyncStatusIndicator() {
  const drive = useDriveState()
  const auto = useAutoSyncState()

  if (drive.status !== 'signed-in') return null

  if (auto.status === 'syncing') {
    return (
      <Link
        to="/settings"
        aria-label="Syncing…"
        title="Syncing…"
        className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-text)"
      >
        <RefreshCw className="size-4 animate-spin" />
      </Link>
    )
  }

  if (auto.status === 'error') {
    return (
      <Link
        to="/settings"
        aria-label="Sync error"
        title={auto.error ?? 'Sync error'}
        className="p-1 rounded-md text-(--color-loss) hover:opacity-80"
      >
        <AlertCircle className="size-4" />
      </Link>
    )
  }

  return null
}
