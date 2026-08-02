import { useEffect, useRef, useState } from 'react'
import { setDayReflection, type DayReflection } from '@/db/queries'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { errorMessage } from '@/lib/utils'

interface DayReflectionSectionProps {
  accountId: string
  date: string // YYYY-MM-DD
  /** Stored continuations for this (account, date); `''` for unanswered. */
  stored: DayReflection
}

// The three beats of one incident, in the order they're written. Stems are UI
// chrome: they're rendered outside the input, so they can't be edited away and
// never reach the DB.
const STEMS: Array<{ field: keyof DayReflection; stem: string }> = [
  { field: 'hardest_moment', stem: 'Today the hardest moment was' },
  { field: 'wanted_to', stem: 'I wanted to' },
  { field: 'instead_did', stem: 'Instead I' },
]

/**
 * The day's reflection — one incident, told as three completions of fixed
 * sentence stems. Not three labelled inputs: the stem sits inline and the
 * answer continues straight off it, so the section reads as unfinished prose
 * you finish rather than a form you fill.
 *
 * Each answer is a plain `<textarea>`. An earlier version used inline
 * `contenteditable` spans, to get long answers wrapping back to the panel's
 * left edge — but a bare editable owns none of the behaviour a real text
 * control gets for free, and every piece had to be rebuilt by hand: the caret
 * didn't paint on an empty line (no line box), the placeholder needed `:empty`
 * plus a stray-`<br>` cleanup on input, clicking needed a row-level handler
 * because an empty inline editable has no width, and — the one that could not
 * be fixed — dragging a selection with a little downward drift collapsed it,
 * because the focus point resolved outside the editing host. A textarea owns
 * its selection, so drift keeps extending it.
 *
 * Persisted per line on blur, matching `DayNoteSection` — keystroke-time
 * writes would mean a Dexie transaction per character.
 */
export function DayReflectionSection({
  accountId,
  date,
  stored,
}: DayReflectionSectionProps) {
  const [error, setError] = useState<string | null>(null)

  async function persist(field: keyof DayReflection, next: string) {
    // Compare trimmed: the store trims on write, so " hello " and "hello" are
    // the same value and shouldn't cost a transaction (or bump `updated_at`
    // and hand the sync layer a spurious change) on every blur.
    if (next.trim() === stored[field]) return
    try {
      await setDayReflection(accountId, date, { [field]: next })
      setError(null)
    } catch (e) {
      // Same reasoning as the note section: the text is still on screen, so a
      // silent failure would let the user walk away believing it was saved.
      setError(`Couldn't save reflection: ${errorMessage(e)}`)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Reflection</h2>
      <div className="bg-(--color-panel) rounded-(--radius) px-3 py-2 space-y-1">
        {STEMS.map(({ field, stem }) => (
          <StemLine
            key={field}
            stem={stem}
            value={stored[field]}
            onCommit={next => void persist(field, next)}
          />
        ))}
        {error && <p className="text-xs text-(--color-loss)">{error}</p>}
      </div>
    </section>
  )
}

interface StemLineProps {
  stem: string
  value: string
  onCommit: (next: string) => void
}

function StemLine({ stem, value, onCommit }: StemLineProps) {
  const ref = useAutosizeTextarea()
  // Uncontrolled: a controlled value would re-render this section — and so the
  // whole Day route's `stored` object — on every keystroke. The DOM owns the
  // text while editing; React writes into it only when the stored value
  // changes from elsewhere (a sync landing) and the line isn't focused.
  const [initial] = useState(value)

  // Kept in a ref so the unmount commit below can stay a mount-only effect
  // while still calling the latest closure (which holds the current stored
  // value to compare against).
  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
  })

  // Commit on unmount as well as on blur. Clicking to another day unmounts the
  // section without the textarea ever blurring, so a sentence typed and not
  // yet left would be silently dropped. `DayNoteSection` gets this for free —
  // TipTap's teardown blurs its editor — and two journal sections on the same
  // page must not disagree about whether typing survives navigation.
  //
  // The element is captured at mount rather than read from `ref.current` in
  // the cleanup, which React has already nulled by then. Committing an
  // unchanged value is a no-op, so the common case (navigating past a day you
  // didn't touch) writes nothing.
  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) commit.current(el.value)
    }
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el || el === document.activeElement) return
    if (el.value === value) return
    el.value = value
    // The autosize hook measures in a layout effect, which has already run by
    // the time this one writes — so a longer synced value would keep the old
    // height until some unrelated render re-fit it. The hook also listens for
    // native `input`, so tell it directly.
    el.dispatchEvent(new Event('input'))
  }, [ref, value])

  return (
    <div className="stem-row text-sm text-(--color-text-dim) leading-relaxed">
      <span className="stem-label">{stem}</span>
      <textarea
        ref={ref}
        rows={1}
        defaultValue={initial}
        aria-label={stem}
        // The trailing dots of an unfinished sentence. A real placeholder, so
        // it clears on input and is never part of the stored value.
        placeholder="…"
        onBlur={e => onCommit(e.currentTarget.value)}
        className="stem-input"
      />
    </div>
  )
}
