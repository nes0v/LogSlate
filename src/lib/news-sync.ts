import { db } from '@/db/schema'
import type { NewsEvent, PersistedNewsImpact } from '@/db/types'
import type { FFEvent } from '@/lib/forex-factory'
import { nyDateKey } from '@/lib/tz'

function isPersistableEvent(
  e: FFEvent,
): e is FFEvent & { impact: PersistedNewsImpact } {
  if (e.country !== 'USD') return false
  return e.impact === 'High' || e.impact === 'Medium'
}

// Unit Separator () is non-printable and effectively impossible inside
// a real news headline, so it can't collide with characters in `title`.
const KEY_SEP = ''
function eventId(date: string, title: string): string {
  return `${date}${KEY_SEP}${title}`
}

/**
 * Replace the persisted news for the date range covered by `events` with
 * exactly what the feed currently reports. Events absent from the fresh
 * batch are deleted (postponed / cancelled releases just disappear).
 *
 * Single transaction; safe to call repeatedly.
 */
export async function syncWeekNews(events: FFEvent[]): Promise<void> {
  const filtered = events.filter(isPersistableEvent)
  if (filtered.length === 0) return

  const now = new Date().toISOString()
  const fetchedById = new Map<string, { event: typeof filtered[number]; dayKey: string }>()
  for (const e of filtered) {
    const d = new Date(e.date)
    if (Number.isNaN(d.getTime())) continue
    const dayKey = nyDateKey(d)
    fetchedById.set(eventId(dayKey, e.title), { event: e, dayKey })
  }
  if (fetchedById.size === 0) return

  const dayKeys = Array.from(new Set(Array.from(fetchedById.values()).map(v => v.dayKey))).sort()
  const fromDay = dayKeys[0]
  const toDay = dayKeys[dayKeys.length - 1]

  await db.transaction('rw', db.news_events, async () => {
    const existing = await db.news_events
      .where('date')
      .between(fromDay, toDay, true, true)
      .toArray()
    const existingCreatedAt = new Map(existing.map(r => [r.id, r.created_at]))

    const upserts: NewsEvent[] = Array.from(fetchedById, ([id, { event, dayKey }]) => ({
      id,
      date: dayKey,
      title: event.title,
      country: event.country,
      impact: event.impact,
      scheduled_at: event.date,
      forecast: event.forecast,
      previous: event.previous,
      created_at: existingCreatedAt.get(id) ?? now,
      updated_at: now,
    }))
    await db.news_events.bulkPut(upserts)

    const staleIds = existing.filter(r => !fetchedById.has(r.id)).map(r => r.id)
    if (staleIds.length > 0) await db.news_events.bulkDelete(staleIds)
  })
}
