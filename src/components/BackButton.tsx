import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

const BTN_CLASS =
  'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-(--radius) bg-(--color-panel) text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) transition-colors'

/**
 * Browser-history back button for non-root pages. Always sits as the
 * leftmost item in a page header, before any per-page prev/next chevrons.
 *
 * Falls back to the calendar root when there's no prior in-app history
 * (e.g. landing on a /day URL via a deep link / fresh tab).
 */
export function BackButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      aria-label="Back"
      title="Back"
      onClick={() => {
        // `react-router`'s history adapter writes an `idx` onto
        // `window.history.state` for each entry it pushes. Idx > 0 means
        // we have at least one in-app entry to pop back to. Falling back
        // to "/" instead of leaving the SPA on a deep-linked URL.
        const idx =
          (window.history.state as { idx?: number } | null)?.idx ?? 0
        if (idx > 0) navigate(-1)
        else navigate('/')
      }}
      className={BTN_CLASS}
    >
      <ArrowLeft className="size-4" />
      <span>back</span>
    </button>
  )
}
