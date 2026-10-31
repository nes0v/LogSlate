import { db } from '@/db/schema'
import type { NewsEvent, TradeRecord } from '@/db/types'
import { getDayFeesOverride, getDayNote, getDayPnlOverride, listDayScreenshotsFor } from '@/db/queries'
import { resolveScreenshotUrl } from '@/lib/drive-images'
import { firstExecutionMs } from '@/lib/trade-math'

// Module-level LRU cache keyed by `${accountId}|${date}`. Every time a
// live query on the Day page resolves, the result is mirrored here, and
// the prev/next neighbours of the current day are warmed in the
// background. On navigation, the next day's render reads its data
// straight out of the cache — no blink while Dexie re-queries.
//
// Cap: ~100 days × per-day payload (trades + news + note + screenshot
// refs, all small string/number records) stays well under a megabyte.
// Eviction uses insertion-order with LRU touch on read, so frequently
// revisited days survive long navigation sessions.
export interface CachedDay {
  trades?: TradeRecord[]
  news?: NewsEvent[]
  note?: string
  screenshots?: string[]
  pnlOverride?: number | null
  feesOverride?: number | null
}
const DAY_CACHE_CAP = 100
const dayDataCache = new Map<string, CachedDay>()
export const dayCacheKey = (accountId: string, date: string) => `${accountId}|${date}`

export function readDayCache(key: string): CachedDay | undefined {
  const entry = dayDataCache.get(key)
  if (entry) {
    // LRU touch: re-insert moves the entry to the end so the oldest
    // entries (the ones a long-session would naturally evict first)
    // are the genuinely least-recently-read ones.
    dayDataCache.delete(key)
    dayDataCache.set(key, entry)
  }
  return entry
}

function writeDayCache(key: string, value: CachedDay): void {
  if (dayDataCache.has(key)) dayDataCache.delete(key)
  dayDataCache.set(key, value)
  while (dayDataCache.size > DAY_CACHE_CAP) {
    const oldest = dayDataCache.keys().next().value
    if (oldest === undefined) break
    dayDataCache.delete(oldest)
  }
}

export function patchDayCache(accountId: string, date: string, patch: CachedDay) {
  if (!accountId || !date) return
  const key = dayCacheKey(accountId, date)
  writeDayCache(key, { ...dayDataCache.get(key), ...patch })
}

// Trade order on the Day page: first execution, with `id` breaking ties —
// times are second-resolution, so same-second trades would otherwise sort in
// whatever order Dexie returned them, and the cache and the live query could
// disagree for a frame.
export function byFirstExecution(a: TradeRecord, b: TradeRecord): number {
  const ka = firstExecutionMs(a) ?? Date.parse(a.created_at)
  const kb = firstExecutionMs(b) ?? Date.parse(b.created_at)
  if (ka !== kb) return ka - kb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Re-read a day into the cache after a trade on it was saved or deleted
 *  elsewhere (the trade pages), so coming back to it paints the new data on
 *  the first frame instead of the cached old one. */
export function refreshDayCache(accountId: string, date: string): Promise<void> {
  return preloadDay(accountId, date, true)
}

/** Re-read every cached day — after a sync or a backup import replaced rows
 *  underneath it, so revisiting a day doesn't paint its old data first. */
export async function refreshAllDayCaches(): Promise<void> {
  await Promise.all(
    [...dayDataCache.keys()].map(key => {
      const [accountId, date] = key.split('|')
      return preloadDay(accountId, date, true)
    }),
  )
}

export async function preloadDay(accountId: string, date: string, force = false): Promise<void> {
  if (!accountId || !date) return
  const key = dayCacheKey(accountId, date)
  if (!force && dayDataCache.has(key)) return
  const [tradeRows, newsRows, note, screenshots, pnlOverride, feesOverride] =
    await Promise.all([
      db.trades.where('[account_id+date]').equals([accountId, date]).toArray(),
      db.news.where('date').equals(date).toArray(),
      getDayNote(accountId, date),
      listDayScreenshotsFor(accountId, date),
      getDayPnlOverride(accountId, date),
      getDayFeesOverride(accountId, date),
    ])
  const trades = tradeRows.sort(byFirstExecution)
  newsRows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  writeDayCache(key, {
    trades,
    news: newsRows,
    note,
    screenshots,
    pnlOverride,
    feesOverride,
  })
  // Warm the screenshot URL cache so thumbs paint as an image on the
  // first frame after navigation instead of flashing the "loading…"
  // placeholder while resolveScreenshotUrl awaits the IndexedDB blob.
  await Promise.all(
    screenshots.map(ref => resolveScreenshotUrl(ref).catch(() => null)),
  )
}
