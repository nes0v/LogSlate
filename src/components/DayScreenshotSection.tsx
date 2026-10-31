import { addDayScreenshot, addPendingDayScreenshot, removeDayScreenshot } from '@/db/queries'
import { dayScreenshotSuffix, discardScreenshotRef } from '@/lib/drive-images'
import { errorMessage } from '@/lib/utils'
import { ScreenshotThumb } from '@/components/ScreenshotThumb'
import { ScreenshotUploadButton } from '@/components/ScreenshotUploadButton'

interface DayScreenshotSectionProps {
  accountId: string
  date: string // YYYY-MM-DD
  /** Existing screenshot refs (`drive:...` / `pending:...`). */
  screenshots: string[]
}

// Per-day screenshots. A day can have any number of them — they live as a
// `screenshots[]` array on the single Day row for (account, date). The
// upload button stays visible so the user can keep adding; each thumb gets
// an X to remove itself (which also deletes the Drive file).
export function DayScreenshotSection({
  accountId,
  date,
  screenshots,
}: DayScreenshotSectionProps) {
  // Off the day first, then the file: if the first step fails, the
  // screenshot is still there and its file still exists.
  async function handleRemove(ref: string) {
    try {
      await removeDayScreenshot(accountId, date, ref)
    } catch (e) {
      alert(`Failed to remove screenshot: ${errorMessage(e)}`)
      return
    }
    await discardScreenshotRef(ref)
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Screenshots</h2>
      <div className="bg-(--color-panel) rounded-(--radius) p-3">
        <div className="flex flex-wrap items-start gap-3">
          {screenshots.map(ref => (
            <ScreenshotThumb
              key={ref}
              value={ref}
              onRemove={() => handleRemove(ref)}
            />
          ))}
          <ScreenshotUploadButton
            date={date}
            getFilenameSuffix={() => dayScreenshotSuffix(date, screenshots.length + 1)}
            onUpload={async stored => {
              if (stored.pending) {
                await addPendingDayScreenshot(accountId, date, stored.pending)
              } else {
                await addDayScreenshot(accountId, date, stored.ref)
              }
            }}
            label={screenshots.length === 0 ? 'Upload' : 'Add'}
          />
        </div>
      </div>
    </section>
  )
}
