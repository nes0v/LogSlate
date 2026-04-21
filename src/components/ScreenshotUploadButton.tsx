import { useState } from 'react'
import { Upload } from 'lucide-react'
import { storeScreenshot } from '@/lib/drive-images'

interface ScreenshotUploadButtonProps {
  /** YYYY-MM-DD — drives the month subfolder and filename. */
  date: string
  /** Resolved lazily at upload time so edit flows can pick up the latest
   *  ordinal. Return something like "trade-3" or "day-2".
   */
  getFilenameSuffix: () => Promise<string> | string
  /** Called with the resolved ref string after a successful upload. */
  onUpload: (ref: string) => Promise<void> | void
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
      const ref = await storeScreenshot(file, { date, filenameSuffix: suffix })
      await onUpload(ref)
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-(--color-border) bg-(--color-panel) hover:bg-(--color-panel-2) cursor-pointer">
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
