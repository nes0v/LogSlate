import {
  discardScreenshotRef,
  parseScreenshotRef,
  type ResolvedScreenshot,
} from '@/lib/drive-images'
import { useDriveState } from '@/lib/drive'
import { ScreenshotThumb } from '@/components/ScreenshotThumb'
import { ScreenshotUploadButton } from '@/components/ScreenshotUploadButton'

interface ScreenshotFieldProps {
  value: string | null
  onChange: (next: string | null) => void
  /** YYYY-MM-DD — drives the month subfolder and filename. */
  date: string
  /** Resolved lazily at upload time so edit flows can pick up the latest
   *  trade ordinal.
   */
  getFilenameSuffix: () => Promise<string> | string
  /** Pre-resolved blob URL / error for the current `value`. The trade
   *  form passes this for the initial screenshot so the thumb renders
   *  in its final state on first paint instead of flashing "loading…". */
  prefetched?: ResolvedScreenshot
}

// Single-value screenshot field: shows the thumb when set (upload button
// hidden), or the upload button when unset. To replace an image, the user
// removes the current one via the X and then picks a new file.
export function ScreenshotField({
  value,
  onChange,
  date,
  getFilenameSuffix,
  prefetched,
}: ScreenshotFieldProps) {
  const drive = useDriveState()
  const ref = parseScreenshotRef(value)
  const isPending = ref?.kind === 'pending'

  async function handleRemove() {
    await discardScreenshotRef(value)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      {value ? (
        <ScreenshotThumb value={value} onRemove={handleRemove} prefetched={prefetched} />
      ) : (
        <ScreenshotUploadButton
          date={date}
          getFilenameSuffix={getFilenameSuffix}
          onUpload={ref => onChange(ref)}
        />
      )}
      {value && isPending && (
        <div className="text-xs text-(--color-text-dim)">
          Pending upload — will sync to Drive
          {drive.status !== 'signed-in' ? ' after you connect in Settings' : ' when you’re online'}.
        </div>
      )}
    </div>
  )
}
