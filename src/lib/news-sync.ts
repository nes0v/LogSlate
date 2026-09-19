import { db } from '@/db/schema'
import type { NewsEvent, PersistedNewsImpact } from '@/db/types'
import { dominantWeek, type FFEvent } from '@/lib/forex-factory'
import { nyDateKey, weekEndKey, weekStartKey } from '@/lib/tz'

function isPersistableEvent(
  e: FFEvent,
): e is FFEvent & { impact: PersistedNewsImpact } {
  if (e.country !== 'USD') return false
  return e.impact === 'High' || e.impact === 'Medium'
}

// Unit Separator () is non-printable and effectively impossible inside
// a real news headline, so it can't collide with characters in `title`.
const KEY_SEP = ''
/**
 * Identity of an event: its exact time, its currency, and its title.
 *
 * All three are needed. The feed repeats a title within a day (a speaker
 * appearing morning and afternoon) and repeats it across currencies on the
 * same day — this week's live feed carries "Unemployment Rate" for both CNY
 * and GBP. Keying on the day alone silently kept whichever row landed last.
 */
function eventId(e: FFEvent): string {
  return `${e.date}${KEY_SEP}${e.country}${KEY_SEP}${e.title}`
}

/** True when the stored row already says exactly what the feed says. */
function unchanged(row: NewsEvent, e: FFEvent, dayKey: string): boolean {
  return (
    row.date === dayKey &&
    row.title === e.title &&
    row.country === e.country &&
    row.impact === e.impact &&
    row.scheduled_at === e.date &&
    row.forecast === e.forecast &&
    row.previous === e.previous
  )
}

/**
 * Bring the archive in line with what the feed currently reports.
 *
 * Within the week the batch speaks for, the archive is made to match it
 * exactly — events that have vanished (postponed, cancelled) are deleted.
 * Anywhere else the batch can only add, never remove.
 *
 * The week, rather than the day, is the unit of truth here because the feed
 * publishes whole Sun-Sat blocks: every day in a fetched week is accounted
 * for, including the quiet ones, so a release cancelled off an otherwise
 * empty day still gets its stale row cleared.
 *
 * Single transaction; safe to call repeatedly.
 */
export async function syncWeekNews(events: FFEvent[]): Promise<void> {
  // The week this batch speaks for. Deletes are confined to it: a batch is
  // evidence about its own week and nothing else, so one stray row dated
  // outside the block must not put the neighbouring week "up for
  // reconciliation" and delete every archived row it does not mention.
  // Strays are still stored — losing data is the half that cannot be undone.
  const speaksFor = dominantWeek(events)

  const now = new Date().toISOString()
  const fetchedById = new Map<
    string,
    { event: FFEvent & { impact: PersistedNewsImpact }; dayKey: string; week: string }
  >()
  const weeks = new Set<string>()
  for (const e of events) {
    const d = new Date(e.date)
    if (Number.isNaN(d.getTime())) continue
    const dayKey = nyDateKey(d)
    // Weeks come from ALL events, any country and impact, not just the
    // persistable USD high/medium subset: a week that comes back with
    // nothing persistable at all must still clear last week's rows.
    weeks.add(weekStartKey(dayKey))
    if (!isPersistableEvent(e)) continue
    fetchedById.set(eventId(e), { event: e, dayKey, week: weekStartKey(dayKey) })
  }
  if (weeks.size === 0) return

  await db.transaction('rw', db.news, async () => {
    for (const week of weeks) {
      const existing = await db.news
        .where('date')
        .between(week, weekEndKey(week), true, true)
        .toArray()
      const existingById = new Map(existing.map(r => [r.id, r]))

      // Skip rows the feed still reports identically. Without this, every
      // launch rewrote every row with a fresh `updated_at`, costing a bulkPut
      // of the whole window and making each row look newly edited to Drive
      // sync when nothing about the event had changed.
      const upserts: NewsEvent[] = []
      for (const [id, { event, dayKey, week: eventWeek }] of fetchedById) {
        if (eventWeek !== week) continue
        const prev = existingById.get(id)
        if (prev && unchanged(prev, event, dayKey)) continue
        upserts.push({
          id,
          date: dayKey,
          title: event.title,
          country: event.country,
          impact: event.impact,
          scheduled_at: event.date,
          forecast: event.forecast,
          previous: event.previous,
          created_at: prev?.created_at ?? now,
          updated_at: now,
        })
      }
      if (upserts.length > 0) await db.news.bulkPut(upserts)

      if (week !== speaksFor) continue
      const staleIds = existing.filter(r => !fetchedById.has(r.id)).map(r => r.id)
      if (staleIds.length > 0) await db.news.bulkDelete(staleIds)
    }
  })
}

/** One archive week: NY day key -> that day's events, earliest first. */
export type ArchivedWeek = Record<string, FFEvent[]>

/**
 * Read a whole week out of the IndexedDB archive, shaped like feed events.
 *
 * A week rather than a day because the panel is paged with arrow keys: a
 * per-day read put an IndexedDB round trip between every click, which is
 * short but long enough to paint a "Loading…" frame. `date` is indexed, so
 * seven days cost one range query and the other six clicks are free.
 *
 * The archive reaches back years, far further than the one-week localStorage
 * cache, but keeps only USD high/medium rows — so a day answered from here is
 * a partial listing, and callers should say so.
 */
export async function readArchivedWeek(weekStart: string): Promise<ArchivedWeek> {
  const rows = await db.news
    .where('date')
    .between(weekStart, weekEndKey(weekStart), true, true)
    .toArray()
  const byDay: ArchivedWeek = {}
  for (const r of rows) {
    ;(byDay[r.date] ??= []).push({
      title: r.title,
      country: r.country,
      date: r.scheduled_at,
      impact: r.impact,
      forecast: r.forecast,
      previous: r.previous,
    })
  }
  for (const events of Object.values(byDay)) {
    events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  }
  return byDay
}
