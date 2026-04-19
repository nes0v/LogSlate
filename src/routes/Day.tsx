import { Link, useParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Plus, ChevronLeft } from 'lucide-react'

export function DayRoute() {
  const { date = '' } = useParams()
  const parsed = date ? parseISO(date) : null
  const pretty = parsed ? format(parsed, 'EEEE, MMMM d, yyyy') : date

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
            aria-label="Back to calendar"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">{pretty}</h1>
        </div>
        <Link
          to={`/trade/new?date=${date}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-(--color-accent) text-white hover:opacity-90"
        >
          <Plus className="size-4" /> New trade
        </Link>
      </div>
      <p className="text-(--color-text-dim)">Day detail (trade list + summary stats). Coming in step 5.</p>
    </div>
  )
}
