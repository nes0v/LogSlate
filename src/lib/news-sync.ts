import { db } from '@/db/schema'
import type { NewsEvent } from '@/db/types'
import type { FFEvent, FFImpact } from '@/lib/forex-factory'
import { nyDateKey } from '@/lib/tz'

export type PersistedImpact = Extract<FFImpact, 'High' | 'Medium'>

// Type guard so the cast in the row constructor goes away.
function isPersistableEvent(e: FFEvent): e is FFEvent & { impact: PersistedImpact } {
  if (e.country !== 'USD') return false
  return e.impact === 'High' || e.impact === 'Medium'
}

// Unit Separator () is non-printable and effectively impossible inside
// a real news headline, so it can't collide with characters in `title`.
const KEY_SEP = ''
function eventId(date: string, title: string): string {
  return `${date}${KEY_SEP}${title}`
}

/**
 * Reconcile a fresh batch of FF events with the persisted news_events table.
 *
 * 1. Filter to USD high/medium impact.
 * 2. Group by NY day; key each by `${date}|${title}`.
 * 3. Bulk-upsert every fetched event (resurrects anything previously cancelled).
 * 4. Anything in the DB whose date sits inside the fetched range, but isn't
 *    in the new set, gets `cancelled = true`. The row stays so the Day page
 *    renders it struck-through.
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
    const existingById = new Map(existing.map(r => [r.id, r]))

    const upserts: NewsEvent[] = []
    for (const [id, { event, dayKey }] of fetchedById) {
      const prev = existingById.get(id)
      upserts.push({
        id,
        date: dayKey,
        title: event.title,
        country: event.country,
        impact: event.impact,
        scheduled_at: event.date,
        forecast: event.forecast,
        previous: event.previous,
        cancelled: false,
        last_seen_at: now,
        created_at: prev?.created_at ?? now,
        updated_at: now,
      })
    }
    await db.news_events.bulkPut(upserts)

    const cancelledIds = existing
      .filter(r => !fetchedById.has(r.id) && !r.cancelled)
      .map(r => r.id)
    if (cancelledIds.length > 0) {
      await db.news_events
        .where('id')
        .anyOf(cancelledIds)
        .modify({ cancelled: true, updated_at: now })
    }
  })
}
