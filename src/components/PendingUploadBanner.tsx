import { Link } from 'react-router-dom'
import { CloudOff } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { useDriveState } from '@/lib/drive'

// Local-storage limits for the pending-upload queue. Screenshots
// captured offline land in `pending_uploads` as inline blobs and only
// drain to Drive on the next sync. Without a ceiling, the queue can
// silently grow until IndexedDB hits a quota error and the next upload
// throws — by which point the user has no clue why. The banner fires
// well before that point and routes them to Settings to reconnect.
const MAX_QUEUED = 20
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

async function readQueueStatus(): Promise<{ count: number; bytes: number }> {
  const rows = await db.pending_uploads.toArray()
  let bytes = 0
  for (const r of rows) bytes += r.blob.size
  return { count: rows.length, bytes }
}

export function PendingUploadBanner() {
  const drive = useDriveState()
  const status = useLiveQuery(readQueueStatus, [])
  if (!status) return null

  if (drive.status === 'signed-in') return null
  if (status.count < MAX_QUEUED && status.bytes < MAX_BYTES) return null

  const reason =
    status.count >= MAX_QUEUED
      ? `${status.count} screenshots are queued locally`
      : `${(status.bytes / (1024 * 1024)).toFixed(0)} MB of screenshots are queued locally`

  return (
    <div
      role="status"
      className="flex items-start gap-3 px-3 py-2 mb-6 -mt-2 rounded-(--radius) border bg-(--color-panel) border-(--color-loss)/40 text-(--color-text)"
    >
      <CloudOff className="size-4 shrink-0 mt-0.5 text-(--color-loss)" />
      <div className="flex-1 text-sm">
        {reason}. Connect Google Drive to free up local storage.
      </div>
      <Link
        to="/settings"
        className="text-sm text-(--color-accent) hover:underline whitespace-nowrap"
      >
        Settings
      </Link>
    </div>
  )
}
