import { useState } from 'react'
import { Upload } from 'lucide-react'
import { storeScreenshot } from '@/lib/drive-images'
import type { StoredScreenshot } from '@/db/types'
import { BTN_GHOST } from '@/components/form/buttonClass'
import { errorMessage } from '@/lib/utils'

interface ScreenshotUploadButtonProps {
  /** YYYY-MM-DD — drives the month subfolder and filename. */
  date: string
  /** Resolved lazily at upload time so the suffix reflects the current
   *  state of the day's screenshot list. Return something like "fri-01".
   */
  getFilenameSuffix: () => Promise<string> | string
  /** Called with the staged screenshot after a successful store. The
   *  handler must persist `stored.pending` (when set) together with the
   *  ref in one transaction. */
  onUpload: (stored: StoredScreenshot) => Promise<void> | void
  label?: string
}

export function ScreenshotUploadButton({
  date,
  getFilenameSuffix,
  onUpload,
  label = 'Upload',
}: ScreenshotUploadButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onPick(file: File | null) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const suffix = await getFilenameSuffix()
      const stored = await storeScreenshot(file, { date, filenameSuffix: suffix })
      await onUpload(stored)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <label className={`${BTN_GHOST} bg-(--color-bg) cursor-pointer`}>
        <Upload className="size-4" />
        <span>{busy ? 'Uploading…' : label}</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={e => {
            const f = e.target.files?.[0] ?? null
            e.target.value = ''
            void onPick(f)
          }}
        />
      </label>
      {error && <span className="text-xs text-(--color-loss)">{error}</span>}
    </div>
  )
}
