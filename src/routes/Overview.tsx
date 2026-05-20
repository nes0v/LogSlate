import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addDays,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { bucketNavTarget, drillDownRange, timeframeFromParams } from '@/lib/stats-nav'
import { ChevronRight, X } from 'lucide-react'
import { dateKeyToDate, nyToday } from '@/lib/tz'
import type { Model } from '@/db/types'
import { listAdjustments, listAllTrades, listModels } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import {
  applyFilters,
  EMPTY_FILTERS,
  FILTER_PARAM_KEYS,
  filtersFromParams,
  paramsFromFilters,
  type TradeFilters,
} from '@/lib/filters'
import {
  defaultRange,
  hasAnyFilter,
  loadSharedFilters,
  saveSharedFilters,
} from '@/lib/shared-filters'
import { computeNetPnl, firstExecutionMs } from '@/lib/trade-math'
import { adjustmentsByDate, aggregate, computeCandles, signedAdjustment } from '@/lib/trade-stats'
import { useStartingEquity } from '@/lib/use-starting-equity'
import {
  bucketByTimeframe,
  dateToBucketKey,
  WEEK_OPTS,
  type Timeframe,
} from '@/lib/buckets'
import { TradingViewChart } from '@/components/TradingViewChart'
import { ChartTimeframeToggle } from '@/components/ChartTimeframeToggle'
import { EquityChartToggle } from '@/components/EquityChartToggle'
import { setDefaultEquityView, useDefaultEquityView } from '@/lib/equity-view-preference'
import { TradeTable } from '@/components/TradeTable'
import {
  CompositeScoreSection,
  DistributionDonuts,
  HeroNetPnl,
} from '@/components/AdvancedStats'
import { StatsFilterBar } from '@/components/StatsFilterBar'
import { BTN_ACCENT } from '@/components/form/buttonClass'

export function OverviewRoute() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // Read the shared slot synchronously on render when the URL is bare —
  // otherwise the first paint uses the default 30-day window and only
  // snaps to the real filter once the hydration effect mirrors slot →
  // URL, which surfaces as a content "jump" on nav-link clicks.
  const urlFilters = useMemo<TradeFilters>(() => {
    if (FILTER_PARAM_KEYS.some(k => params.has(k))) {
      return filtersFromParams(params)
    }
    const stored = loadSharedFilters()
    if (stored && hasAnyFilter(stored)) return stored
    return filtersFromParams(params)
  }, [params])
  const equityView = useDefaultEquityView()
  const [tableExpandedIds, setTableExpandedIds] = useState<Set<string>>(() => new Set())
  const toggleTableRow = useCallback((id: string) => {
    setTableExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Keep URL filters and the shared slot in sync on every navigation —
  // (1) URL with filter params → mirror them into the slot so the user
  //     can hop to another page and find the same filter applied.
  // (2) URL with no filter params → hydrate from the slot (preserving
  //     any non-filter params like `tf` already in the URL).
  // This makes deep-link arrivals (e.g. a calendar week-card) persist,
  // and clicking the nav link back to this page restores filters
  // instead of dropping them.
  useEffect(() => {
    const hasFilterParam = FILTER_PARAM_KEYS.some(k => params.has(k))
    if (!hasFilterParam) {
      const stored = loadSharedFilters()
      if (stored && hasAnyFilter(stored)) {
        const next = new URLSearchParams(params)
        paramsFromFilters(stored).forEach((v, k) => next.set(k, v))
        setParams(next, { replace: true })
      }
      return
    }
    const f = filtersFromParams(params)
    saveSharedFilters(hasAnyFilter(f) ? f : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])
  const timeframe = timeframeFromParams(params)
  // Latest visible bucket-key range reported by the chart. The chart
  // emits this on every drag/zoom frame, so it lives in a ref to avoid
  // re-rendering Stats per frame; only the derived "off-default" boolean
  // surfaces as React state and only flips when it actually changes.
  const visibleRangeRef = useRef<{ from: string; to: string } | null>(null)
  const [showSetRangeBtn, setShowSetRangeBtn] = useState(false)
  // Bumped by `clear()` to make the chart snap back to the default
  // filter range — would otherwise stay bar-preserved if Clear also
  // changed the timeframe (e.g. clearing while on W).
  const [viewportEpoch, setViewportEpoch] = useState(0)

  const accountId = useActiveAccountId()
  // No default value — `allTrades` is `undefined` while Dexie resolves so
  // we can suppress the empty-state placeholder + downstream sections
  // until the real data arrives. Without this, "No trades yet" shows for
  // a single frame and then snaps to the actual content.
  const allTrades = useLiveQuery(() => listAllTrades(accountId), [accountId])
  const allAdjustments = useLiveQuery(
    () => listAdjustments(accountId),
    [accountId],
    [],
  )
  // Models are resolved once at the route level so trade rows render
  // with the right name on first paint (instead of flashing "gambling"
  // before the lookup map populates).
  const models = useLiveQuery(
    () => listModels(accountId),
    [accountId],
  )
  const modelById = useMemo(() => {
    const m = new Map<string, Model>()
    for (const p of models ?? []) m.set(p.id, p)
    return m
  }, [models])
  const loaded = allTrades !== undefined && models !== undefined

  // Most recent trade date — anchors the default filter so Stats lands
  // on the user's actual trading window. Falls back to today before
  // any trades exist.
  const lastTradeDate = useMemo(() => {
    const list = allTrades ?? []
    if (list.length === 0) return nyToday()
    let max = list[0].date
    for (const t of list) if (t.date > max) max = t.date
    return max
  }, [allTrades])

  // Effective filters = URL filters with the default 30-day window
  // (ending on `lastTradeDate`) filled in for any unset bound. The URL
  // stays clean (no params) for the default view; params only appear
  // when the user deviates from it.
  const filters = useMemo<TradeFilters>(() => {
    const d = defaultRange(lastTradeDate)
    return {
      ...urlFilters,
      from: urlFilters.from ?? d.from,
      to: urlFilters.to ?? d.to,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, lastTradeDate])

  const filtered = useMemo(() => applyFilters(allTrades ?? [], filters), [allTrades, filters])
  // Aggregate once at the route level and pass down. Previously each
  // memo'd child (HeroNetPnl, CompositeScoreSection) computed
  // `aggregate(filtered)` independently — same data, multiple
  // full-array passes per render.
  const stats = useMemo(() => aggregate(filtered), [filtered])

  // Lazy-mount the TradingView chart on a tick after the rest of the
  // page has painted. The chart synchronously builds canvases, primitives,
  // ~365 whitespace timestamps, and pushes the candle stream — that's the
  // single largest contributor to first-paint latency on Stats.
  const [chartReady, setChartReady] = useState(false)
  useEffect(() => {
    if (chartReady) return
    // requestIdleCallback isn't on all browsers (Safari < 17 etc.); a 0ms
    // timeout schedules a macrotask after paint, which is good enough.
    const handle =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback(() => setChartReady(true))
        : window.setTimeout(() => setChartReady(true), 0)
    return () => {
      if (typeof cancelIdleCallback !== 'undefined' && typeof handle === 'number') {
        // Best-effort; idle and timeout handles are interchangeable as
        // numbers in the TS lib types.
        try {
          cancelIdleCallback(handle)
        } catch {
          clearTimeout(handle)
        }
      } else {
        clearTimeout(handle as number)
      }
    }
  }, [chartReady])

  // Bucket trades by day across the filter range (falling back to first/last
  // traded day when no explicit from/to). Using the filter bounds makes charts
  // show every day in the period, not just days that had trades.
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (filters.from && filters.to) return { rangeStart: filters.from, rangeEnd: filters.to }
    if (filtered.length === 0) return { rangeStart: null, rangeEnd: null }
    const dates = filtered.map(t => t.date).sort()
    return {
      rangeStart: filters.from ?? dates[0],
      rangeEnd: filters.to ?? dates[dates.length - 1],
    }
  }, [filtered, filters.from, filters.to])

  // Inputs the composite-score card needs. Computed locally from the
  // already-loaded `allTrades` + `allAdjustments` so the card doesn't
  // need its own Dexie subscriptions — that's what was causing the
  // post-mount jump (queries resolve async; card renders null first,
  // then snaps in with real data). Now everything is ready when the
  // page-level `loaded` gate opens.
  const compositeStartingEquity = useMemo(() => {
    if (!rangeStart) return 0
    let eq = 0
    for (const a of allAdjustments ?? []) {
      if (a.date < rangeStart) eq += signedAdjustment(a)
    }
    for (const t of allTrades ?? []) {
      if (t.date < rangeStart) eq += computeNetPnl(t) ?? 0
    }
    return eq
  }, [allTrades, allAdjustments, rangeStart])
  const compositeAdjByDate = useMemo(() => {
    const m = new Map<string, number>()
    if (!rangeStart || !rangeEnd) return m
    for (const a of allAdjustments ?? []) {
      if (a.date >= rangeStart && a.date <= rangeEnd) {
        m.set(a.date, (m.get(a.date) ?? 0) + signedAdjustment(a))
      }
    }
    return m
  }, [allAdjustments, rangeStart, rangeEnd])

  // Chart trades = `allTrades` with non-date filters applied. The date
  // filter only sets the initial viewport (`chartVisibleFrom/To` below),
  // so the chart contains every trade ever recorded for this account
  // and the user can pan/zoom outside the filter window to see the rest.
  const chartFiltered = useMemo(
    () => applyFilters(allTrades ?? [], { ...filters, from: null, to: null }),
    [allTrades, filters],
  )

  // Bucket-aligned range that spans the earliest..latest dates across
  // chart trades AND adjustments — picking up adjustments that fall
  // outside the trades' window (e.g. a deposit before the first trade).
  const tfChartRange = useMemo(() => {
    const dates: string[] = []
    for (const t of chartFiltered) dates.push(t.date)
    for (const a of allAdjustments ?? []) dates.push(a.date)
    if (dates.length === 0) return null
    dates.sort()
    const s = dateKeyToDate(dates[0])
    const e = dateKeyToDate(dates[dates.length - 1])
    switch (timeframe) {
      case 'D': return { start: s, end: e }
      case 'W': return { start: startOfWeek(s, WEEK_OPTS), end: endOfWeek(e, WEEK_OPTS) }
      case 'M': return { start: startOfMonth(s), end: endOfMonth(e) }
      case 'Q': return { start: startOfQuarter(s), end: endOfQuarter(e) }
      case 'Y': return { start: startOfYear(s), end: endOfYear(e) }
    }
  }, [chartFiltered, allAdjustments, timeframe])

  const chartAdjByDate = useMemo(
    () => adjustmentsByDate(allAdjustments ?? []),
    [allAdjustments],
  )

  const chartStartingEquity = useStartingEquity(
    tfChartRange ? format(tfChartRange.start, 'yyyy-MM-dd') : null,
  )

  const tfBuckets = useMemo(() => {
    if (!tfChartRange) return []
    const endPlusOne = addDays(tfChartRange.end, 1)
    return bucketByTimeframe(timeframe, chartFiltered, tfChartRange.start, endPlusOne)
  }, [chartFiltered, tfChartRange, timeframe])

  const tfAdjByBucket = useMemo(() => {
    const map = new Map<string, number>()
    for (const [dateKey, amount] of chartAdjByDate.entries()) {
      const k = dateToBucketKey(dateKey, timeframe)
      map.set(k, (map.get(k) ?? 0) + amount)
    }
    return map
  }, [chartAdjByDate, timeframe])

  const tfCandles = useMemo(
    () =>
      computeCandles(
        tfBuckets.map(b => ({ ...b, label: b.key })),
        tfAdjByBucket,
        chartStartingEquity ?? 0,
      ),
    [tfBuckets, tfAdjByBucket, chartStartingEquity],
  )

  const tfAdjustmentMarkers = useMemo(() => {
    const keys = new Set(tfBuckets.map(b => b.key))
    const out: Array<{ x: string; amount: number }> = []
    for (const [key, amount] of tfAdjByBucket) {
      if (keys.has(key)) out.push({ x: key, amount })
    }
    return out
  }, [tfAdjByBucket, tfBuckets])

  // Filter's bucket-aligned keys, used to compare against the chart's
  // emitted visible-range keys (so the "Set date filter" button only
  // shows when they actually differ).
  const filterFromKey = rangeStart ? dateToBucketKey(rangeStart, timeframe) : undefined
  const filterToKey = rangeEnd ? dateToBucketKey(rangeEnd, timeframe) : undefined

  // Chronological order — oldest trade at the top, newest at the bottom.
  const tradesDesc = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1
        return (firstExecutionMs(a) ?? 0) - (firstExecutionMs(b) ?? 0)
      }),
    [filtered],
  )

  // Writes the user-facing change back to URL params. If a field matches
  // the default range, we drop it so the URL stays clean on the default
  // view. `tf` is preserved when not in `next` (so filter edits don't
  // reset the chart timeframe) and dropped when it equals the default D.
  function update(next: Partial<TradeFilters> & { tf?: Timeframe }) {
    const d = defaultRange(lastTradeDate)
    const merged: TradeFilters = { ...urlFilters, ...next }
    if (merged.from === d.from) merged.from = null
    if (merged.to === d.to) merged.to = null
    saveSharedFilters(hasAnyFilter(merged) ? merged : null)
    const p = paramsFromFilters(merged)
    const tf = 'tf' in next ? next.tf : timeframeFromParams(params)
    if (tf && tf !== 'D') p.set('tf', tf)
    setParams(p)
  }

  function setTimeframe(tf: Timeframe) {
    update({ tf })
  }

  // Expand a single bucket key under the active timeframe to the full
  // date range it represents — used when the user clicks "Set date
  // filter" to translate the chart's visible bucket-key window back
  // into the YYYY-MM-DD `from`/`to` shape the filter expects.
  function bucketKeyToDateRange(key: string): { from: string; to: string } | null {
    if (timeframe === 'D') return /^\d{4}-\d{2}-\d{2}$/.test(key) ? { from: key, to: key } : null
    const drill = drillDownRange(timeframe, key)
    return drill ? { from: drill.from, to: drill.to } : null
  }

  function setFilterToVisible() {
    const cur = visibleRangeRef.current
    if (!cur) return
    const left = bucketKeyToDateRange(cur.from)
    const right = bucketKeyToDateRange(cur.to)
    if (!left || !right) return
    update({ from: left.from, to: right.to })
  }

  // Filter keys live in a ref so the chart's onVisibleRangeChange callback
  // can compare against the latest values without changing identity (which
  // would force the chart to re-subscribe). Synced via the same effect
  // that re-evaluates the off-default flag below.
  const filterKeysRef = useRef<{ from: string | undefined; to: string | undefined }>({
    from: filterFromKey,
    to: filterToKey,
  })

  // Drag/zoom emits visible range; ref'd to dodge per-frame re-renders.
  // Only the boolean visibility of the "Set date to range" button is
  // hoisted to React state, and only updated when its value flips.
  const handleVisibleRangeChange = useCallback((from: string, to: string) => {
    visibleRangeRef.current = { from, to }
    const off = from !== filterKeysRef.current.from || to !== filterKeysRef.current.to
    setShowSetRangeBtn(prev => (prev === off ? prev : off))
  }, [])

  // When the filter (or timeframe) changes the chart doesn't re-emit, so
  // sync the cached filter keys and re-evaluate the off-default flag from
  // the latest visible range.
  useEffect(() => {
    filterKeysRef.current = { from: filterFromKey, to: filterToKey }
    const cur = visibleRangeRef.current
    if (!cur) return
    const off = cur.from !== filterFromKey || cur.to !== filterToKey
    setShowSetRangeBtn(prev => (prev === off ? prev : off))
  }, [filterFromKey, filterToKey])

  // "Clear" returns to the bare /overview URL and restores the chart's
  // default state: filter back to the last-30-days default, timeframe
  // back to D (URL clear handles tf), and viewport snapped to the new
  // default range via an epoch bump. The Line/Candles toggle is the
  // persisted preference itself, so it stays where the user left it.
  function clear() {
    saveSharedFilters(null)
    setParams(paramsFromFilters(EMPTY_FILTERS))
    setViewportEpoch(e => e + 1)
  }

  const isDefault = !hasAnyFilter(urlFilters)

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Overview</h1>
        {!isDefault && (
          <button onClick={clear} className={BTN_ACCENT}>
            <X className="size-4" /> Clear filters
          </button>
        )}
      </div>

      <StatsFilterBar filters={filters} update={update} />

      {filtered.length > 0 && (
        <details className="space-y-2 group">
          <summary className="text-sm font-medium cursor-pointer text-(--color-text) hover:text-(--color-accent) list-none flex items-center gap-1 transition-colors">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
            Trades{' '}
            <span className="text-(--color-text-dim) font-normal">({filtered.length})</span>
          </summary>
          <TradeTable
            trades={tradesDesc}
            expandedIds={tableExpandedIds}
            onToggle={toggleTableRow}
            modelById={modelById}
          />
        </details>
      )}

      {filtered.length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <HeroNetPnl stats={stats} />
            <CompositeScoreSection
              filtered={filtered}
              stats={stats}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              accountStartEquity={compositeStartingEquity}
              adjByDate={compositeAdjByDate}
            />
          </div>
          <DistributionDonuts filtered={filtered} models={models ?? []} />
        </>
      )}

      {filtered.length > 0 && chartReady ? (
        <TradingViewChart
          points={tfCandles}
          adjustments={tfAdjustmentMarkers}
          timeframe={timeframe}
          viewportFrom={rangeStart ?? undefined}
          viewportTo={rangeEnd ?? undefined}
          viewportEpoch={viewportEpoch}
          onVisibleRangeChange={handleVisibleRangeChange}
          onPointClick={key => {
            // W/M/Q/Y clicks drill into the bucket on /overview;
            // D clicks navigate to the day page.
            const drill = drillDownRange(timeframe, key)
            if (drill) update(drill)
            else navigate(bucketNavTarget(key, timeframe))
          }}
          title="Equity and fees"
          height={698}
          view={equityView === 'curve' ? 'line' : 'candles'}
          headerRight={
            <div className="flex items-center gap-2">
              {showSetRangeBtn && (
                <button
                  type="button"
                  onClick={setFilterToVisible}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono rounded-(--radius) bg-(--color-panel) text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) transition-colors"
                >
                  Set date to range
                </button>
              )}
              <EquityChartToggle value={equityView} onChange={setDefaultEquityView} />
              <ChartTimeframeToggle value={timeframe} onChange={setTimeframe} />
            </div>
          }
        />
      ) : loaded ? (
        <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
          {allTrades.length === 0
            ? 'No trades yet.'
            : 'No trades match the current filters.'}
        </div>
      ) : null}
    </div>
  )
}
