import { addDayScreenshot, addPendingDayScreenshot, removeDayScreenshot } from '@/db/queries'
import { dayScreenshotSuffix, discardScreenshotRef } from '@/lib/drive-images'
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
  async function handleRemove(ref: string) {
    await discardScreenshotRef(ref)
    await removeDayScreenshot(accountId, date, ref)
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
