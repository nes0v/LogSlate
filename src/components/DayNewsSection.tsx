import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { NewsEvent } from '@/db/types'
import { nyTimeHHmm } from '@/lib/tz'

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
      <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) overflow-hidden">
        {events.length === 0 ? (
          <div className="p-3 text-xs text-(--color-text-dim)">No USD high/medium events.</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {events.map(e => (
                <NewsRow key={e.id} event={e} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

function NewsRow({ event }: { event: NewsEvent }) {
  const d = new Date(event.scheduled_at)
  const time = Number.isNaN(d.getTime()) ? '—' : nyTimeHHmm(d)
  return (
    <tr className="border-t border-(--color-bg) [&>td]:pt-[7px] [&>td]:pb-[9px] [&>td]:align-middle">
      <td className="pl-3 pr-6 text-xs font-mono tabular-nums text-(--color-text-dim) w-px whitespace-nowrap">
        {time}
      </td>
      <td className="pl-0 pr-6 text-xs font-mono text-(--color-text-dim) uppercase w-px whitespace-nowrap">
        {event.country}
      </td>
      <td className="pl-0 pr-3 w-px">
        <svg
          viewBox="0 0 10 10"
          className="size-3 block"
          aria-label={`${event.impact} impact`}
          role="img"
        >
          <circle cx="5" cy="5" r="4.5" fill={IMPACT_FILL[event.impact]} />
        </svg>
      </td>
      <td className="pl-0 pr-3 text-xs truncate">{event.title}</td>
    </tr>
  )
}
