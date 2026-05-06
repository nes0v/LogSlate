import { useEffect, useState } from 'react'
import { setDayNote } from '@/db/queries'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { errorMessage } from '@/lib/utils'

interface DayNoteSectionProps {
  accountId: string
  date: string // YYYY-MM-DD
  /** Stored note value for this (account, date); empty string if none. */
  stored: string
}

/**
 * Free-text journal entry for the day. Stored on the Day row's `note`
 * field (one row per (account, date)). Persisted on blur — typing-time
 * writes would cause a Dexie transaction per keystroke.
 *
 * Local `value` state shadows the parent-supplied stored value so typing
 * feels immediate; we re-sync from `stored` only when it changes from a
 * different source (cross-device sync) and the textarea isn't currently
 * focused.
 */
export function DayNoteSection({ accountId, date, stored }: DayNoteSectionProps) {
  const [value, setValue] = useState(stored)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useAutosizeTextarea()

  useEffect(() => {
    if (document.activeElement === textareaRef.current) return
    setValue(stored)
    // textareaRef is a stable ref object; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  async function handleBlur() {
    if (value === stored) return
    try {
      await setDayNote(accountId, date, value)
      setError(null)
    } catch (e) {
      setError(`Couldn't save note: ${errorMessage(e)}`)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Notes</h2>
      <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-drop-xs)">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="What did you notice today?"
          className="block w-full bg-(--color-panel) rounded-(--radius) px-2.5 py-1.5 text-sm font-sans text-(--color-text-dim) placeholder:text-(--color-text-faint) min-h-[95px] resize-none overflow-hidden focus:outline-none"
        />
      </div>
      {error && <div className="text-xs text-(--color-loss)">{error}</div>}
    </section>
  )
}
