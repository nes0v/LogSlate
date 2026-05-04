import { addDayScreenshot, removeDayScreenshot } from '@/db/queries'
import {
  discardScreenshotRef,
  type ResolvedScreenshot,
} from '@/lib/drive-images'
import { ScreenshotThumb } from '@/components/ScreenshotThumb'
import { ScreenshotUploadButton } from '@/components/ScreenshotUploadButton'

interface DayScreenshotSectionProps {
  accountId: string
  date: string // YYYY-MM-DD
  /** Existing screenshot refs (`drive:...` / `pending:...`). */
  screenshots: string[]
  /** Pre-resolved blob URL / error per ref. The Day route resolves all
   *  refs in parallel and gates the page load on completion, so the
   *  thumbs render in their final state instead of flashing through
   *  "loading…" tiles one-by-one as Drive responds. */
  resolved: Map<string, ResolvedScreenshot>
}

// Per-day screenshots. A day can have any number of them — they live as a
// `screenshots[]` array on the single Day row for (account, date). The
// upload button stays visible so the user can keep adding; each thumb gets
// an X to remove itself (which also deletes the Drive file).
export function DayScreenshotSection({
  accountId,
  date,
  screenshots,
  resolved,
}: DayScreenshotSectionProps) {
  async function handleRemove(ref: string) {
    await discardScreenshotRef(ref)
    await removeDayScreenshot(accountId, date, ref)
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Screenshots</h2>
      <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3">
        <div className="flex flex-wrap items-start gap-3">
          {screenshots.map(ref => (
            <ScreenshotThumb
              key={ref}
              value={ref}
              onRemove={() => handleRemove(ref)}
              prefetched={resolved.get(ref)}
            />
          ))}
          <ScreenshotUploadButton
            date={date}
            getFilenameSuffix={() => `day-${screenshots.length + 1}`}
            onUpload={async ref => {
              await addDayScreenshot(accountId, date, ref)
            }}
            label={screenshots.length === 0 ? 'Upload' : 'Add'}
          />
        </div>
      </div>
    </section>
  )
}
