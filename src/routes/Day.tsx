import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, isWeekend, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { db, dayHasContent } from '@/db/schema'
import type { Model, NewsEvent, TradeRecord } from '@/db/types'
import { getDayNote, getDayPnlOverride, listDayScreenshotsFor, listModels } from '@/db/queries'
import { parseScreenshotRef, resolveScreenshotUrl } from '@/lib/drive-images'
import { useActiveAccountId } from '@/lib/active-account'
import { firstExecutionMs } from '@/lib/trade-math'
import { aggregate } from '@/lib/trade-stats'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { DayNewsSection } from '@/components/DayNewsSection'
import { DayNoteSection } from '@/components/DayNoteSection'
import { DayPnlOverrideSection } from '@/components/DayPnlOverrideSection'
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
  pnlOverride?: number | null
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
  const [tradeRows, newsRows, note, screenshots, pnlOverride] = await Promise.all([
    db.trades.where('[account_id+date]').equals([accountId, date]).toArray(),
    db.news.where('date').equals(date).toArray(),
    getDayNote(accountId, date),
    listDayScreenshotsFor(accountId, date),
    getDayPnlOverride(accountId, date),
  ])
  const trades = tradeRows.sort((a, b) => {
    const ka = firstExecutionMs(a) ?? Date.parse(a.created_at)
    const kb = firstExecutionMs(b) ?? Date.parse(b.created_at)
    if (ka !== kb) return ka - kb
    // Second-resolution times tie for same-second trades — break on `id`
    // so the order is deterministic across renders.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  newsRows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  writeDayCache(key, { trades, news: newsRows, note, screenshots, pnlOverride })
  // Warm the screenshot URL cache so thumbs paint as an image on the
  // first frame after navigation instead of flashing the "loading…"
  // placeholder while resolveScreenshotUrl awaits the IndexedDB blob.
  await Promise.all(
    screenshots.map(ref => resolveScreenshotUrl(ref).catch(() => null)),
  )
}

// Weekend guard. The calendar already makes Saturday/Sunday cells
// non-clickable, but a hand-typed `/day/2026-06-20` URL would still land on
// a weekend page — which can carry no trades and no P&L override. Bounce it
// to that date's month calendar. Kept in a thin wrapper so the heavy
// `DayView` either mounts fully or not at all (stable hook order); a bare
// early-return inside DayView would skip its hooks and trip rules-of-hooks
// when navigating between a weekday and a weekend date on the same route.
export function DayRoute() {
  const { date = '' } = useParams()
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISO(date) : null
  if (parsed && isWeekend(parsed)) {
    return <Navigate to={`/month/${date.slice(0, 7)}`} replace />
  }
  return <DayView />
}

function DayView() {
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
      return { forDate: date, forAccount: accountId, rows: sorted }
    },
    [date, accountId],
  )
  const newsResult = useLiveQuery(
    async () => {
      const rows = await db.news.where('date').equals(date).toArray()
      // ISO 8601 strings sort lexicographically — no Date.parse needed.
      rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      patchDayCache(accountId, date, { news: rows })
      return { forDate: date, forAccount: accountId, rows }
    },
    [date, accountId],
  )
  const noteResult = useLiveQuery(
    async () => {
      const value = await getDayNote(accountId, date)
      patchDayCache(accountId, date, { note: value })
      return { forDate: date, forAccount: accountId, value }
    },
    [accountId, date],
  )
  const screenshotsResult = useLiveQuery(
    async () => {
      const rows = await listDayScreenshotsFor(accountId, date)
      patchDayCache(accountId, date, { screenshots: rows })
      return { forDate: date, forAccount: accountId, rows }
    },
    [accountId, date],
  )
  const pnlOverrideResult = useLiveQuery(
    async () => {
      const value = await getDayPnlOverride(accountId, date)
      patchDayCache(accountId, date, { pnlOverride: value })
      return { forDate: date, forAccount: accountId, value }
    },
    [accountId, date],
  )
  // Stale-while-revalidate: fall back to the module cache so a navigation
  // to a preloaded neighbour renders with data on the first frame instead
  // of unmounting the content section until Dexie settles. Reading
  // through `readDayCache` also LRU-touches the entry so a revisited
  // day survives eviction.
  // Require BOTH date and account to match the live result — otherwise an
  // account switch (same date URL) leaves the stale previous-account result
  // satisfying `forDate === date`, flashing account A's data under B.
  const fresh = <T extends { forDate: string; forAccount: string }>(r: T | undefined) =>
    r !== undefined && r.forDate === date && r.forAccount === accountId
  const cached = readDayCache(dayCacheKey(accountId, date))
  const trades = fresh(tradesResult) ? tradesResult!.rows : cached?.trades
  const news = fresh(newsResult) ? newsResult!.rows : cached?.news
  const note = fresh(noteResult) ? noteResult!.value : cached?.note
  const screenshots = fresh(screenshotsResult) ? screenshotsResult!.rows : cached?.screenshots
  const pnlOverride = fresh(pnlOverrideResult)
    ? pnlOverrideResult!.value
    : cached?.pnlOverride
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
    // Route the no-pending case through the same resolved promise rather
    // than flipping the flag synchronously — `allSettled([])` settles on
    // the next microtask, which keeps the gate off the synchronous
    // setState-in-effect path (avoids the cascading render).
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
    pnlOverride !== undefined &&
    models !== undefined &&
    pendingFirstPaintDone

  // Every distinct day that holds something for this account — a trade OR a
  // day row with content (note, screenshot, or P&L override) — used to skip
  // genuinely-empty days in prev/next navigation. Trade dates come from the
  // compound index via `uniqueKeys()` (no rows pulled into memory); day rows
  // are filtered by the shared `dayHasContent` keep-rule and merged in.
  const navigableDays = useLiveQuery(
    async () => {
      const tradeKeys = await db.trades
        .where('[account_id+date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .uniqueKeys()
      const set = new Set(tradeKeys.map(k => (k as unknown as [string, string])[1]))
      const dayRows = await db.days.where('account_id').equals(accountId).toArray()
      for (const d of dayRows) if (dayHasContent(d)) set.add(d.date)
      // Drop weekend dates: a note/screenshot/override could be stored on a
      // Sat/Sun, but the weekend Day page redirects to the month view — so a
      // weekend neighbour would make prev/next bounce out of the Day view.
      return Array.from(set)
        .filter(k => !isWeekend(parseISO(k)))
        .sort()
    },
    [accountId],
    [] as string[],
  )

  const { prevDate, nextDate } = useMemo(() => {
    const list = navigableDays ?? []
    let prev: string | null = null
    let next: string | null = null
    for (const d of list) {
      if (d < date) prev = d
      else if (d > date && next === null) next = d
    }
    return { prevDate: prev, nextDate: next }
  }, [navigableDays, date])

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

  // When the day carries a manual net-P&L override, it replaces the trade-
  // derived net in the day's headline stats (the per-trade counts below stay
  // as-is — the override isn't a trade).
  const stats = useMemo(() => {
    const base = aggregate(trades ?? [])
    return pnlOverride != null ? { ...base, net_pnl: pnlOverride } : base
  }, [trades, pnlOverride])

  // The day-override and trades are mutually exclusive (a tilt day is logged
  // as one net figure INSTEAD of its individual trades). An override is
  // "active" when one is stored; in that state we hide the New-trade button.
  // The override field itself stays visible whenever there are no trades OR
  // an override already exists, so a legacy both-day can still be cleared.
  const overrideActive = pnlOverride != null
  const showOverrideField = (trades?.length ?? 0) === 0 || overrideActive

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
        title={pretty}
        prev={prevDate ? `/day/${prevDate}` : null}
        next={nextDate ? `/day/${nextDate}` : null}
        prevLabel="Previous day with activity"
        nextLabel="Next day with activity"
        rightSlot={
          overrideActive ? undefined : (
            <Link
              to={`/trade/new?date=${date}`}
              state={{ from: `/day/${date}` }}
              className={BTN_ACCENT}
            >
              <Plus className="size-4" /> New trade
            </Link>
          )
        }
      />

      {/* Everything below the header is gated on ALL day-scoped queries so
          the page renders as a single unit. Children receive their data
          as props — no per-section live queries that would each settle
          asynchronously and produce a multi-stage flicker. */}
      {loaded ? (
        <>
          <StatsGrid stats={stats} hideBreakdown={overrideActive} />

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

          {showOverrideField && (
            <DayPnlOverrideSection
              key={date}
              accountId={accountId}
              date={date}
              stored={pnlOverride ?? null}
            />
          )}

          {!overrideActive && (
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
          )}
        </>
      ) : null}
    </div>
  )
}
