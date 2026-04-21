import { useLiveQuery } from 'dexie-react-hooks'
import {
  addDayScreenshot,
  deleteDayScreenshot,
  listDayScreenshotsFor,
} from '@/db/queries'
import { discardScreenshotRef } from '@/lib/drive-images'
import { ScreenshotThumb } from '@/components/ScreenshotThumb'
import { ScreenshotUploadButton } from '@/components/ScreenshotUploadButton'

interface DayScreenshotSectionProps {
  accountId: string
  date: string // YYYY-MM-DD
}

// Per-day screenshots. A day can have any number of them — each one is its
// own row. The upload button stays visible so the user can keep adding; each
// thumb gets an X to remove itself (which also deletes the Drive file).
export function DayScreenshotSection({ accountId, date }: DayScreenshotSectionProps) {
  const list = useLiveQuery(
    () => listDayScreenshotsFor(accountId, date),
    [accountId, date],
    [],
  )
  const rows = list ?? []

  async function handleRemove(id: string, ref: string | null) {
    await discardScreenshotRef(ref)
    await deleteDayScreenshot(id)
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Day screenshots</h2>
      <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
        <div className="flex flex-wrap items-start gap-3">
          {rows.map(r =>
            r.screenshot ? (
              <ScreenshotThumb
                key={r.id}
                value={r.screenshot}
                onRemove={() => handleRemove(r.id, r.screenshot)}
              />
            ) : null,
          )}
          <ScreenshotUploadButton
            date={date}
            getFilenameSuffix={() => `day-${rows.length + 1}`}
            onUpload={async ref => {
              await addDayScreenshot(accountId, date, ref)
            }}
            label={rows.length === 0 ? 'Upload' : 'Add'}
          />
        </div>
      </div>
    </section>
  )
}
