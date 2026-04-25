import { useMemo, useState } from 'react'
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
import { X } from 'lucide-react'
import type { ContractType, Rating, Session, SymbolKey } from '@/db/types'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import {
  applyFilters,
  EMPTY_FILTERS,
  filtersFromParams,
  paramsFromFilters,
  type TradeFilters,
} from '@/lib/filters'
import { adjustmentsByDate, aggregate, computeCandles } from '@/lib/trade-stats'
import { useStartingEquity } from '@/lib/use-starting-equity'
import {
  bucketByDay,
  bucketByTimeframe,
  bucketByWeek,
  dateToBucketKey,
  WEEK_OPTS,
  type Timeframe,
} from '@/lib/buckets'
import { StatsGrid } from '@/components/StatsGrid'
import { TradingViewChart } from '@/components/TradingViewChart'
import { ChartTimeframeToggle } from '@/components/ChartTimeframeToggle'
import { WeeklyCards } from '@/components/WeeklyCards'
import { EquityChartToggle, type EquityView } from '@/components/EquityChartToggle'
import { getDefaultEquityView } from '@/lib/equity-view-preference'
import { PeriodBreakdown } from '@/components/PeriodBreakdown'
import { FacetBreakdown } from '@/components/FacetBreakdown'
import { TradeRow, TRADE_ROW_COLS } from '@/components/TradeRow'
import { Pills } from '@/components/form/Pills'
import { Field, inputClass } from '@/components/form/Field'
import { cn } from '@/lib/utils'

const SYMBOL_OPTS = [
  { value: null, label: 'All' },
  { value: 'NQ' as const, label: 'NQ' },
  { value: 'ES' as const, label: 'ES' },
] satisfies Array<{ value: SymbolKey | null; label: string }>

const CONTRACT_OPTS = [
  { value: null, label: 'All' },
  { value: 'micro' as const, label: 'Micro' },
  { value: 'mini' as const, label: 'Mini' },
] satisfies Array<{ value: ContractType | null; label: string }>

const SESSION_OPTS = [
  { value: null, label: 'All' },
  { value: 'pre' as const, label: 'Pre' },
  { value: 'AM' as const, label: 'AM' },
  { value: 'LT' as const, label: 'LT' },
  { value: 'PM' as const, label: 'PM' },
  { value: 'aft' as const, label: 'Aft' },
] satisfies Array<{ value: Session | null; label: string }>

const RATING_OPTS = [
  { value: null, label: 'All' },
  { value: 'good' as const, label: '👍' },
  { value: 'excellent' as const, label: '🔥' },
  { value: 'egg' as const, label: '🥚' },
] satisfies Array<{ value: Rating | null; label: string }>

/** Default date filter — 30 days (inclusive) ending on `baseDate`.
 *  `baseDate` is the most recent trade date when any exists, falling
 *  back to today, so opening Stats lands you on your real trading
 *  window instead of a probably-empty trailing 30 days. */
function defaultRange(baseDate: string) {
  const base = new Date(baseDate + 'T00:00:00')
  return {
    from: format(addDays(base, -29), 'yyyy-MM-dd'),
    to: baseDate,
  }
}

export function StatsRoute() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const urlFilters = filtersFromParams(params)
  const [equityView, setEquityView] = useState<EquityView>(getDefaultEquityView)
  const timeframe = timeframeFromParams(params)
  // Latest visible bucket-key range reported by the chart. Compared
  // against the filter's bucket keys to decide whether to surface a
  // "Set date filter" button; null until the chart first emits.
  const [visibleRange, setVisibleRange] = useState<{ from: string; to: string } | null>(null)
  // Bumped by `clear()` to make the chart snap back to the default
  // filter range — would otherwise stay bar-preserved if Clear also
  // changed the timeframe (e.g. clearing while on W).
  const [viewportEpoch, setViewportEpoch] = useState(0)

  const accountId = useActiveAccountId()
  const allTrades = useLiveQuery(
    () =>
      db.trades
        .where('[account_id+trade_date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .toArray(),
    [accountId],
    [],
  )
  const allAdjustments = useLiveQuery(
    () =>
      db.adjustments
        .where('[account_id+date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .toArray(),
    [accountId],
    [],
  )

  // Most recent trade date — anchors the default filter so Stats lands
  // on the user's actual trading window. Falls back to today before
  // any trades exist.
  const lastTradeDate = useMemo(() => {
    const list = allTrades ?? []
    if (list.length === 0) return format(new Date(), 'yyyy-MM-dd')
    let max = list[0].trade_date
    for (const t of list) if (t.trade_date > max) max = t.trade_date
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

  const stats = aggregate(filtered)

  // Bucket trades by day across the filter range (falling back to first/last
  // traded day when no explicit from/to). Using the filter bounds makes charts
  // show every day in the period, not just days that had trades.
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (filters.from && filters.to) return { rangeStart: filters.from, rangeEnd: filters.to }
    if (filtered.length === 0) return { rangeStart: null, rangeEnd: null }
    const dates = filtered.map(t => t.trade_date).sort()
    return {
      rangeStart: filters.from ?? dates[0],
      rangeEnd: filters.to ?? dates[dates.length - 1],
    }
  }, [filtered, filters.from, filters.to])

  const startingEquity = useStartingEquity(rangeStart)
  const roi = startingEquity > 0 ? stats.net_pnl / startingEquity : null

  const weeks = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    return bucketByWeek(filtered, new Date(rangeStart + 'T00:00:00'), new Date(rangeEnd + 'T00:00:00'))
  }, [filtered, rangeStart, rangeEnd])

  const dayBuckets = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    return bucketByDay(filtered, new Date(rangeStart + 'T00:00:00'), new Date(rangeEnd + 'T00:00:00'))
  }, [filtered, rangeStart, rangeEnd])

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
    for (const t of chartFiltered) dates.push(t.trade_date)
    for (const a of allAdjustments ?? []) dates.push(a.date)
    if (dates.length === 0) return null
    dates.sort()
    const s = new Date(dates[0] + 'T00:00:00')
    const e = new Date(dates[dates.length - 1] + 'T00:00:00')
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
        chartStartingEquity,
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

  const bySymbol = useMemo(
    () => [
      { label: 'NQ', trades: filtered.filter(t => t.symbol === 'NQ') },
      { label: 'ES', trades: filtered.filter(t => t.symbol === 'ES') },
    ],
    [filtered],
  )
  const byContract = useMemo(
    () => [
      { label: 'Micro', trades: filtered.filter(t => t.contract_type === 'micro') },
      { label: 'Mini', trades: filtered.filter(t => t.contract_type === 'mini') },
    ],
    [filtered],
  )
  const bySession = useMemo(
    () =>
      (['pre', 'AM', 'LT', 'PM', 'aft'] as const).map(s => ({
        label: s,
        trades: filtered.filter(t => t.session === s),
      })),
    [filtered],
  )
  const byRating = useMemo(
    () => [
      { label: '👍 good', trades: filtered.filter(t => t.rating === 'good') },
      { label: '🔥 excellent', trades: filtered.filter(t => t.rating === 'excellent') },
      { label: '🥚 egg', trades: filtered.filter(t => t.rating === 'egg') },
    ],
    [filtered],
  )

  // Chronological order — oldest trade at the top, newest at the bottom.
  const tradesDesc = useMemo(() => {
    function firstExec(t: typeof filtered[number]): number {
      let min = Infinity
      for (const e of t.executions) {
        const ms = Date.parse(e.time)
        if (!Number.isNaN(ms) && ms < min) min = ms
      }
      return min === Infinity ? 0 : min
    }
    return [...filtered].sort((a, b) => {
      if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? -1 : 1
      return firstExec(a) - firstExec(b)
    })
  }, [filtered])

  // Writes the user-facing change back to URL params. If a field matches
  // the default range, we drop it so the URL stays clean on the default
  // view. `tf` is preserved when not in `next` (so filter edits don't
  // reset the chart timeframe) and dropped when it equals the default D.
  function update(next: Partial<TradeFilters> & { tf?: Timeframe }) {
    const d = defaultRange(lastTradeDate)
    const merged: TradeFilters = { ...urlFilters, ...next }
    if (merged.from === d.from) merged.from = null
    if (merged.to === d.to) merged.to = null
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
    if (!visibleRange) return
    const left = bucketKeyToDateRange(visibleRange.from)
    const right = bucketKeyToDateRange(visibleRange.to)
    if (!left || !right) return
    update({ from: left.from, to: right.to })
  }

  // "Clear" returns to the bare /stats URL and restores the chart's
  // default state: filter back to the last-30-days default, timeframe
  // back to D (URL clear handles tf), Line/Candles back to the
  // per-account stored preference, and viewport snapped to the new
  // default range via an epoch bump.
  function clear() {
    setParams(paramsFromFilters(EMPTY_FILTERS))
    setEquityView(getDefaultEquityView())
    setViewportEpoch(e => e + 1)
  }

  const isDefault = params.toString() === ''

  return (
    <div className="pt-2 space-y-8">
      <div className="flex items-center justify-between mb-9">
        <h1 className="text-lg font-semibold">Stats</h1>
        {!isDefault && (
          <button
            onClick={clear}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
          >
            <X className="size-3" /> Clear filters
          </button>
        )}
      </div>

      <section className="bg-(--color-panel) border border-(--color-border) rounded-md p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" className="w-40">
            <input
              type="date"
              className={inputClass}
              value={filters.from ?? ''}
              onChange={e => update({ from: e.target.value || null })}
            />
          </Field>
          <Field label="To" className="w-40">
            <input
              type="date"
              className={inputClass}
              value={filters.to ?? ''}
              onChange={e => update({ to: e.target.value || null })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Field label="Symbol">
            <Pills value={filters.symbol} onChange={v => update({ symbol: v })} options={SYMBOL_OPTS} />
          </Field>
          <Field label="Contract">
            <Pills value={filters.contract} onChange={v => update({ contract: v })} options={CONTRACT_OPTS} />
          </Field>
          <Field label="Session">
            <Pills value={filters.session} onChange={v => update({ session: v })} options={SESSION_OPTS} />
          </Field>
          <Field label="Rating">
            <Pills value={filters.rating} onChange={v => update({ rating: v })} options={RATING_OPTS} />
          </Field>
        </div>
      </section>

      <StatsGrid stats={stats} roi={roi} />

      {filtered.length > 0 ? (
        <>
          <TradingViewChart
            points={tfCandles}
            adjustments={tfAdjustmentMarkers}
            timeframe={timeframe}
            viewportFrom={rangeStart ?? undefined}
            viewportTo={rangeEnd ?? undefined}
            viewportEpoch={viewportEpoch}
            onVisibleRangeChange={(from, to) => {
              setVisibleRange(prev =>
                prev && prev.from === from && prev.to === to ? prev : { from, to },
              )
            }}
            onPointClick={key => {
              // W/M/Q/Y clicks drill into the bucket on /stats;
              // D clicks navigate to the day page.
              const drill = drillDownRange(timeframe, key)
              if (drill) update(drill)
              else navigate(bucketNavTarget(key, timeframe))
            }}
            variant="dark"
            title="Equity and fees"
            height={698}
            view={equityView === 'curve' ? 'line' : 'candles'}
            headerRight={
              <div className="flex items-center gap-2">
                {visibleRange &&
                  (visibleRange.from !== filterFromKey ||
                    visibleRange.to !== filterToKey) && (
                    <button
                      type="button"
                      onClick={setFilterToVisible}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono rounded-md border border-(--color-border) bg-(--color-panel) text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) transition-colors"
                    >
                      Set date to range
                    </button>
                  )}
                <EquityChartToggle value={equityView} onChange={setEquityView} />
                <ChartTimeframeToggle value={timeframe} onChange={setTimeframe} />
              </div>
            }
          />
          <div className="grid md:grid-cols-2 gap-x-4 gap-y-8">
            <FacetBreakdown title="By Symbol" items={bySymbol} />
            <FacetBreakdown title="By Contract" items={byContract} />
            <FacetBreakdown title="By Session" items={bySession} />
            <FacetBreakdown title="By Rating" items={byRating} />
          </div>
          <WeeklyCards buckets={weeks} />
          <PeriodBreakdown title="Days" buckets={dayBuckets} />
          <section>
            <h2 className="text-sm font-medium mb-2">
              Trades <span className="text-(--color-text-dim) font-normal">({filtered.length})</span>
            </h2>
            <div className={cn('grid gap-x-5 gap-y-1.5', TRADE_ROW_COLS)}>
              {tradesDesc.map((t, i) => (
                <TradeRow key={t.id} trade={t} index={i + 1} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className={cn('text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-md')}>
          {allTrades && allTrades.length === 0
            ? 'No trades yet.'
            : 'No trades match the current filters.'}
        </div>
      )}
    </div>
  )
}
