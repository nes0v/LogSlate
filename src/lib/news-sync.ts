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
  // Derive the covered day range from ALL fetched events (any country /
  // impact), not just the persistable USD high/medium subset. A quiet week
  // with zero persistable events must still clear last week's stale rows in
  // its range — deriving the range only from the kept events would skip the
  // delete pass entirely on such a week.
  const allDayKeys: string[] = []
  for (const e of events) {
    const d = new Date(e.date)
    if (!Number.isNaN(d.getTime())) allDayKeys.push(nyDateKey(d))
  }
  if (allDayKeys.length === 0) return
  allDayKeys.sort()
  const fromDay = allDayKeys[0]
  const toDay = allDayKeys[allDayKeys.length - 1]

  const now = new Date().toISOString()
  const fetchedById = new Map<string, { event: FFEvent & { impact: PersistedNewsImpact }; dayKey: string }>()
  for (const e of events) {
    if (!isPersistableEvent(e)) continue
    const d = new Date(e.date)
    if (Number.isNaN(d.getTime())) continue
    const dayKey = nyDateKey(d)
    fetchedById.set(eventId(dayKey, e.title), { event: e, dayKey })
  }

  await db.transaction('rw', db.news, async () => {
    const existing = await db.news
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
    if (upserts.length > 0) await db.news.bulkPut(upserts)

    const staleIds = existing.filter(r => !fetchedById.has(r.id)).map(r => r.id)
    if (staleIds.length > 0) await db.news.bulkDelete(staleIds)
  })
}
