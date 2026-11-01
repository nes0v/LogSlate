import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, isWeekend, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { db, dayHasContent } from '@/db/schema'
import type { Model } from '@/db/types'
import { getDayFeesOverride, getDayNote, getDayPnlOverride, listDayScreenshotsFor, listModels } from '@/db/queries'
import {
  byFirstExecution,
  dayCacheKey,
  patchDayCache,
  preloadDay,
  readDayCache,
} from '@/lib/day-cache'
import { parseScreenshotRef, resolveScreenshotUrl } from '@/lib/drive-images'
import { useActiveAccountId } from '@/lib/active-account'
import { aggregate } from '@/lib/trade-stats'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { dateKeyToDate, isDateKey, latestTradeDate } from '@/lib/tz'
import { NotFoundRoute } from '@/routes/NotFound'
import { DayNewsSection } from '@/components/DayNewsSection'
import { DayNoteSection } from '@/components/DayNoteSection'
import { DayPnlOverrideSection } from '@/components/DayPnlOverrideSection'
import { DayScreenshotSection } from '@/components/DayScreenshotSection'
import { PageHeader } from '@/components/PageHeader'
import { StatsGrid } from '@/components/StatsGrid'
import { TradeTable } from '@/components/TradeTable'
import { BTN_ACCENT } from '@/components/form/buttonClass'

// The last navigable-day list per account, for the first frame (see DayView).
const navigableDaysCache = new Map<string, string[]>()

// Weekend guard. The calendar already makes Saturday/Sunday cells
// non-clickable, but a hand-typed `/day/2026-06-20` URL would still land on
// a weekend page — which can carry no trades and no PNL override. Bounce it
// to that date's month calendar. Kept in a thin wrapper so the heavy
// `DayView` either mounts fully or not at all (stable hook order); a bare
// early-return inside DayView would skip its hooks and trip rules-of-hooks
// when navigating between a weekday and a weekend date on the same route.
export function DayRoute() {
  const { date = '' } = useParams()
  // `isDateKey`, not a shape regex: `/day/2026-13-45` matches the shape but
  // parses to an Invalid Date, which would throw out of `format` below.
  // Neither it nor `/day/garbage` is a real date, so both are Not found.
  if (!isDateKey(date)) return <NotFoundRoute />
  if (isWeekend(dateKeyToDate(date))) {
    return <Navigate to={`/month/${date.slice(0, 7)}`} replace />
  }
  return <DayView />
}

function DayView() {
  // `date` is guaranteed a real weekday key by `DayRoute` above.
  const { date = '' } = useParams()
  const navigate = useNavigate()
  const pretty = format(dateKeyToDate(date), 'EEEE, dd MMM yyyy')

  const accountId = useActiveAccountId()
  // All six day-scoped queries live here so the page can reveal as a
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
      const sorted = rows.sort(byFirstExecution)
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
  const feesOverrideResult = useLiveQuery(
    async () => {
      const value = await getDayFeesOverride(accountId, date)
      patchDayCache(accountId, date, { feesOverride: value })
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
  const feesOverride = fresh(feesOverrideResult)
    ? feesOverrideResult!.value
    : cached?.feesOverride
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
    feesOverride !== undefined &&
    models !== undefined &&
    pendingFirstPaintDone

  // Every distinct day that holds something for this account — a trade OR a
  // day row with content (note, screenshot, or PNL override) — used to skip
  // genuinely-empty days in prev/next navigation. Trade dates come from the
  // compound index via `uniqueKeys()` (no rows pulled into memory); day rows
  // are filtered by the shared `dayHasContent` keep-rule and merged in.
  const navigableResult = useLiveQuery(
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
      const days = Array.from(set)
        .filter(k => !isWeekend(parseISO(k)))
        .sort()
      navigableDaysCache.set(accountId, days)
      return { forAccount: accountId, days }
    },
    [accountId],
  )
  // Tagged with its account so a switch can't use the old account's days for
  // a frame; until the query lands, the last list seen for this account
  // keeps the prev/next arrows on the first frame.
  const navigableDays =
    navigableResult?.forAccount === accountId
      ? navigableResult.days
      : navigableDaysCache.get(accountId)

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

  // When the day carries a manual net-PNL override, it replaces the trade-
  // derived net in the day's headline stats (the per-trade counts below stay
  // as-is — the override isn't a trade).
  const stats = useMemo(() => {
    const base = aggregate(trades ?? [])
    if (pnlOverride == null) return base
    // Override replaces the day's net. If informational fees were recorded,
    // fold them in and re-derive gross as net + fees so the breakdown
    // reconciles; otherwise fees are unknown (left at the trade-derived 0).
    const fees = feesOverride ?? 0
    return { ...base, net_pnl: pnlOverride, fees, gross_pnl: pnlOverride + fees }
  }, [trades, pnlOverride, feesOverride])

  // The day-override and trades are mutually exclusive (a tilt day is logged
  // as one net figure INSTEAD of its individual trades). An override is
  // "active" when one is stored; in that state we hide the New-trade button.
  // The override field shows only on a day with no trades.
  const overrideActive = pnlOverride != null
  const showOverrideField = (trades?.length ?? 0) === 0

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
          // Held back until the override has loaded: on an override day it
          // would otherwise show for a frame and vanish. None on a day that
          // hasn't happened yet.
          pnlOverride === undefined || overrideActive || date > latestTradeDate() ? undefined : (
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
          <StatsGrid
            stats={stats}
            hideBreakdown={overrideActive && feesOverride == null}
            emptyPnl={(trades?.length ?? 0) === 0 && !overrideActive}
          />

          <DayNewsSection events={news} />

          {/* Keyed on account AND date so the editor can't show the previous
              day's note for one frame after navigation while its sync effect
              catches up to the new `stored` value. The account half
              matters just as much: an account switch keeps the same URL, so
              without it React reuses the mounted component and only swaps the
              props — leaving one account's draft state sitting above the other
              account's stored value. */}
          <DayNoteSection
            key={`note-${accountId}-${date}`}
            accountId={accountId}
            date={date}
            stored={note}
          />

          <DayScreenshotSection
            accountId={accountId}
            date={date}
            screenshots={screenshots}
          />

          {!overrideActive && trades.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">
                Trades{' '}
                <span className="text-(--color-text-dim) font-normal">
                  ({trades.length})
                </span>{' '}
                <span className="text-(--color-win) font-normal">{stats.wins}W</span>{' '}
                <span className="text-(--color-loss) font-normal">{stats.losses}L</span>
              </h2>
              <TradeTable
                trades={trades}
                expandedIds={expandedIds}
                onToggle={toggleExpanded}
                modelById={modelById}
              />
            </section>
          )}

          {showOverrideField && (
            <DayPnlOverrideSection
              // Account + date. This section flushes its local value on unmount,
              // and that write is addressed by whatever (account, date) the
              // component currently holds — so state carried across an account
              // switch wrote one account's figure, or a stale blank, onto the
              // other's day. Remounting per account keeps the two in lockstep.
              key={`override-${accountId}-${date}`}
              accountId={accountId}
              date={date}
              stored={pnlOverride ?? null}
              storedFees={feesOverride ?? null}
            />
          )}
        </>
      ) : null}
    </div>
  )
}
