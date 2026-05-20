import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { db } from '@/db/schema'
import type { Model, NewsEvent, TradeRecord } from '@/db/types'
import { getDayNote, listDayScreenshotsFor, listModels } from '@/db/queries'
import { parseScreenshotRef, resolveScreenshotUrl } from '@/lib/drive-images'
import { useActiveAccountId } from '@/lib/active-account'
import { firstExecutionMs } from '@/lib/trade-math'
import { aggregate } from '@/lib/trade-stats'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { DayNewsSection } from '@/components/DayNewsSection'
import { DayNoteSection } from '@/components/DayNoteSection'
import { DayScreenshotSection } from '@/components/DayScreenshotSection'
import { PageHeader } from '@/components/PageHeader'
import { StatsGrid } from '@/components/StatsGrid'
import { TradeTable } from '@/components/TradeTable'
import { BTN_ACCENT } from '@/components/form/buttonClass'

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
interface CachedDay {
  trades?: TradeRecord[]
  news?: NewsEvent[]
  note?: string
  screenshots?: string[]
}
const DAY_CACHE_CAP = 100
const dayDataCache = new Map<string, CachedDay>()
const dayCacheKey = (accountId: string, date: string) => `${accountId}|${date}`

function readDayCache(key: string): CachedDay | undefined {
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

function patchDayCache(accountId: string, date: string, patch: CachedDay) {
  if (!accountId || !date) return
  const key = dayCacheKey(accountId, date)
  writeDayCache(key, { ...dayDataCache.get(key), ...patch })
}

async function preloadDay(accountId: string, date: string): Promise<void> {
  if (!accountId || !date) return
  const key = dayCacheKey(accountId, date)
  if (dayDataCache.has(key)) return
  const [tradeRows, newsRows, note, screenshots] = await Promise.all([
    db.trades.where('[account_id+date]').equals([accountId, date]).toArray(),
    db.news.where('date').equals(date).toArray(),
    getDayNote(accountId, date),
    listDayScreenshotsFor(accountId, date),
  ])
  const trades = tradeRows.sort((a, b) => {
    const ka = firstExecutionMs(a) ?? Date.parse(a.created_at)
    const kb = firstExecutionMs(b) ?? Date.parse(b.created_at)
    return ka - kb
  })
  newsRows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  writeDayCache(key, { trades, news: newsRows, note, screenshots })
  // Warm the screenshot URL cache so thumbs paint as an image on the
  // first frame after navigation instead of flashing the "loading…"
  // placeholder while resolveScreenshotUrl awaits the IndexedDB blob.
  await Promise.all(
    screenshots.map(ref => resolveScreenshotUrl(ref).catch(() => null)),
  )
}

export function DayRoute() {
  const { date = '' } = useParams()
  const navigate = useNavigate()
  const parsed = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISO(date) : null
  const pretty = parsed ? format(parsed, 'EEEE, MMMM d, yyyy') : date

  const accountId = useActiveAccountId()
  // All four day-scoped queries live here so the page can reveal as a
  // single unit. Each result is tagged with the `date` it was loaded
  // for and unwrapped only when that date matches the current URL —
  // otherwise dexie-react-hooks' stale-while-revalidate behaviour
  // briefly surfaces the previous day's data (screenshots, trades,
  // note) before the new queries settle, producing a visible flash.
  const tradesResult = useLiveQuery(
    async () => {
      const rows = await db.trades
        .where('[account_id+date]')
        .equals([accountId, date])
        .toArray()
      const sortKey = (t: typeof rows[number]) =>
        firstExecutionMs(t) ?? Date.parse(t.created_at)
      const sorted = rows.sort((a, b) => sortKey(a) - sortKey(b))
      patchDayCache(accountId, date, { trades: sorted })
      return { forDate: date, rows: sorted }
    },
    [date, accountId],
  )
  const newsResult = useLiveQuery(
    async () => {
      const rows = await db.news.where('date').equals(date).toArray()
      // ISO 8601 strings sort lexicographically — no Date.parse needed.
      rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      patchDayCache(accountId, date, { news: rows })
      return { forDate: date, rows }
    },
    [date, accountId],
  )
  const noteResult = useLiveQuery(
    async () => {
      const value = await getDayNote(accountId, date)
      patchDayCache(accountId, date, { note: value })
      return { forDate: date, value }
    },
    [accountId, date],
  )
  const screenshotsResult = useLiveQuery(
    async () => {
      const rows = await listDayScreenshotsFor(accountId, date)
      patchDayCache(accountId, date, { screenshots: rows })
      return { forDate: date, rows }
    },
    [accountId, date],
  )
  // Stale-while-revalidate: fall back to the module cache so a navigation
  // to a preloaded neighbour renders with data on the first frame instead
  // of unmounting the content section until Dexie settles. Reading
  // through `readDayCache` also LRU-touches the entry so a revisited
  // day survives eviction.
  const cached = readDayCache(dayCacheKey(accountId, date))
  const trades = tradesResult?.forDate === date ? tradesResult.rows : cached?.trades
  const news = newsResult?.forDate === date ? newsResult.rows : cached?.news
  const note = noteResult?.forDate === date ? noteResult.value : cached?.note
  const screenshots =
    screenshotsResult?.forDate === date ? screenshotsResult.rows : cached?.screenshots
  // Models are resolved once at the route level so trade rows render with
  // the right name on first paint instead of flashing "gambling" → real.
  const models = useLiveQuery(
    () => listModels(accountId),
    [accountId],
  )
  const modelById = useMemo(() => {
    const m = new Map<string, Model>()
    for (const p of models ?? []) m.set(p.id, p)
    return m
  }, [models])
  // First-paint gate: on a cold open (hard reload / deep-link) we want
  // pending screenshots fully resolved + decoded before revealing the
  // page so each thumb paints as an image straight away with no
  // loading-placeholder flash. `resolveScreenshotUrl` decodes
  // internally and writes the URL cache, so awaiting `allSettled` over
  // every pending ref is sufficient. Once the flag flips on it stays
  // on — subsequent navigations rely on `preloadDay` + the in-thumb
  // cache check, so re-gating would just re-introduce the blink.
  const [pendingFirstPaintDone, setPendingFirstPaintDone] = useState(false)
  useEffect(() => {
    if (pendingFirstPaintDone) return
    if (!screenshots) return
    const pending = screenshots.filter(
      r => parseScreenshotRef(r)?.kind === 'pending',
    )
    if (pending.length === 0) {
      setPendingFirstPaintDone(true)
      return
    }
    let cancelled = false
    void Promise.allSettled(pending.map(ref => resolveScreenshotUrl(ref))).then(
      () => {
        if (!cancelled) setPendingFirstPaintDone(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [screenshots, pendingFirstPaintDone])

  const loaded =
    trades !== undefined &&
    news !== undefined &&
    note !== undefined &&
    screenshots !== undefined &&
    models !== undefined &&
    pendingFirstPaintDone

  // Every distinct day that has trades for this account — used to skip empty
  // days in prev/next navigation. `uniqueKeys()` walks the compound index
  // without pulling trade rows into memory, so this stays cheap even with
  // hundreds of trades.
  const tradingDays = useLiveQuery(
    async () => {
      const keys = await db.trades
        .where('[account_id+date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .uniqueKeys()
      return keys.map(k => (k as unknown as [string, string])[1])
    },
    [accountId],
    [] as string[],
  )

  const { prevDate, nextDate } = useMemo(() => {
    const list = tradingDays ?? []
    let prev: string | null = null
    let next: string | null = null
    for (const d of list) {
      if (d < date) prev = d
      else if (d > date && next === null) next = d
    }
    return { prevDate: prev, nextDate: next }
  }, [tradingDays, date])

  useArrowNavigation({
    prev: prevDate ? `/day/${prevDate}` : null,
    next: nextDate ? `/day/${nextDate}` : null,
    navigate,
  })

  // Pre-warm the cache for adjacent traded days so prev/next navigation
  // renders straight from cache on the first frame.
  useEffect(() => {
    if (prevDate) void preloadDay(accountId, prevDate)
    if (nextDate) void preloadDay(accountId, nextDate)
  }, [accountId, prevDate, nextDate])

  const stats = aggregate(trades ?? [])

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  // Stable identity so the memoized `<TradeTable>` doesn't re-render on
  // every parent render.
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="pt-1 space-y-8">
      <PageHeader
        back
        title={pretty}
        prev={prevDate ? `/day/${prevDate}` : null}
        next={nextDate ? `/day/${nextDate}` : null}
        prevLabel="Previous day with trades"
        nextLabel="Next day with trades"
        rightSlot={
          <Link to={`/trade/new?date=${date}`} className={BTN_ACCENT}>
            <Plus className="size-4" /> New trade
          </Link>
        }
      />

      {/* Everything below the header is gated on ALL day-scoped queries so
          the page renders as a single unit. Children receive their data
          as props — no per-section live queries that would each settle
          asynchronously and produce a multi-stage flicker. */}
      {loaded ? (
        <>
          <StatsGrid stats={stats} />

          <DayNewsSection events={news} />

          {/* Keyed on `date` so the textarea's local `value` state can't
              flash the previous day's note for one frame after navigation
              while its internal `stored → value` sync effect catches up. */}
          <DayNoteSection key={date} accountId={accountId} date={date} stored={note} />

          <DayScreenshotSection
            accountId={accountId}
            date={date}
            screenshots={screenshots}
          />

          <section className="space-y-2">
            <h2 className="text-sm font-medium">
              Trades{' '}
              <span className="text-(--color-text-dim) font-normal">
                ({trades.length})
              </span>{' '}
              <span className="text-(--color-win) font-normal">{stats.wins}W</span>{' '}
              <span className="text-(--color-loss) font-normal">{stats.losses}L</span>
            </h2>
            {trades.length > 0 ? (
              <TradeTable
                trades={trades}
                expandedIds={expandedIds}
                onToggle={toggleExpanded}
                modelById={modelById}
              />
            ) : (
              <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
                No trades on this day yet.
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
