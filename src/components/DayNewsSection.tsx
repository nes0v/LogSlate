import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { NewsEvent } from '@/db/types'
import { nyTimeHHmm } from '@/lib/tz'
import { cn } from '@/lib/utils'

const IMPACT_FILL: Record<NewsEvent['impact'], string> = {
  High: '#ef4444',
  Medium: '#f59e0b',
}

interface DayNewsSectionProps {
  /** YYYY-MM-DD (NY calendar day). */
  date: string
}

export function DayNewsSection({ date }: DayNewsSectionProps) {
  const events = useLiveQuery(
    async () => {
      const rows = await db.news_events.where('date').equals(date).toArray()
      // ISO 8601 strings sort lexicographically — no Date.parse needed.
      rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      return rows
    },
    [date],
    [] as NewsEvent[],
  )

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">News</h2>
      <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs)">
        {events.length === 0 ? (
          <div className="p-3 text-xs text-(--color-text-dim)">No USD high/medium events.</div>
        ) : (
          <div className="divide-y divide-(--color-border)">
            {events.map(e => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function EventRow({ event }: { event: NewsEvent }) {
  const d = new Date(event.scheduled_at)
  const time = Number.isNaN(d.getTime()) ? '—' : nyTimeHHmm(d)
  return (
    <div
      className={cn(
        'grid grid-cols-[3.5rem_auto_auto_1fr] gap-3 items-center px-3 py-2 text-xs',
        event.cancelled && 'line-through text-(--color-text-faint)',
      )}
      title={event.cancelled ? 'Cancelled / postponed' : undefined}
    >
      <span className="font-mono tabular-nums text-(--color-text-dim)">{time}</span>
      <span className="font-mono text-(--color-text-dim) uppercase w-10">{event.country}</span>
      <svg viewBox="0 0 10 10" className="size-3" aria-label={`${event.impact} impact`} role="img">
        <circle cx="5" cy="5" r="4.5" fill={IMPACT_FILL[event.impact]} />
      </svg>
      <span className="truncate">{event.title}</span>
    </div>
  )
}
