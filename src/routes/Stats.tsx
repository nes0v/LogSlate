import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns'
import { X } from 'lucide-react'
import type { ContractType, Rating, Session, SymbolKey } from '@/db/types'
import { db } from '@/db/schema'
import {
  applyFilters,
  EMPTY_FILTERS,
  filtersFromParams,
  paramsFromFilters,
  type TradeFilters,
} from '@/lib/filters'
import { adjustmentsByDate, aggregate, computeCandles } from '@/lib/trade-stats'
import { bucketByDay, bucketByWeek, chartDayLabel } from '@/lib/buckets'
import { StatsGrid } from '@/components/StatsGrid'
import { EquityCurve } from '@/components/EquityCurve'
import { CandlestickChart } from '@/components/CandlestickChart'
import { FeesChart } from '@/components/FeesChart'
import { WeeklyCards } from '@/components/WeeklyCards'
import { EquityChartToggle, type EquityView } from '@/components/EquityChartToggle'
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
  { value: 'meh' as const, label: '🥚' },
] satisfies Array<{ value: Rating | null; label: string }>

export function StatsRoute() {
  const [params, setParams] = useSearchParams()
  const urlFilters = filtersFromParams(params)
  const [equityView, setEquityView] = useState<EquityView>('curve')

  // Effective filters = URL filters with current month as the default date
  // range when none is specified. The URL stays clean (no params) for the
  // default view; params only appear when the user deviates from it.
  const filters = useMemo<TradeFilters>(() => {
    const now = new Date()
    return {
      ...urlFilters,
      from: urlFilters.from ?? format(startOfMonth(now), 'yyyy-MM-dd'),
      to: urlFilters.to ?? format(endOfMonth(now), 'yyyy-MM-dd'),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const allTrades = useLiveQuery(() => db.trades.orderBy('trade_date').toArray(), [], [])
  const allAdjustments = useLiveQuery(
    () => db.adjustments.orderBy('date').toArray(),
    [],
    [],
  )

  const filtered = useMemo(() => applyFilters(allTrades ?? [], filters), [allTrades, filters])
  const adjustmentsInRange = useMemo(() => {
    const list = allAdjustments ?? []
    return list.filter(a => {
      if (filters.from && a.date < filters.from) return false
      if (filters.to && a.date > filters.to) return false
      return true
    })
  }, [allAdjustments, filters.from, filters.to])
  const adjByDate = useMemo(() => adjustmentsByDate(adjustmentsInRange), [adjustmentsInRange])

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

  const days = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    // Include one extra day after the range so charts show the first of the
    // following month as the right edge.
    const endPlusOne = addDays(new Date(rangeEnd + 'T00:00:00'), 1)
    return bucketByDay(filtered, new Date(rangeStart + 'T00:00:00'), endPlusOne)
  }, [filtered, rangeStart, rangeEnd])

  // Every day is a tick; Recharts handles spacing via `interval={0}` on the XAxis.
  const xTicks = useMemo(() => days.map(b => chartDayLabel(b.key)), [days])

  const weeks = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    return bucketByWeek(filtered, new Date(rangeStart + 'T00:00:00'), new Date(rangeEnd + 'T00:00:00'))
  }, [filtered, rangeStart, rangeEnd])

  const dayBuckets = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    return bucketByDay(filtered, new Date(rangeStart + 'T00:00:00'), new Date(rangeEnd + 'T00:00:00'))
  }, [filtered, rangeStart, rangeEnd])

  const equityPoints = useMemo(
    () =>
      days.map(b => ({
        key: b.key,
        label: chartDayLabel(b.key),
        pnl: aggregate(b.trades).net_pnl + (adjByDate.get(b.key) ?? 0),
        count: b.trades.length,
      })),
    [days, adjByDate],
  )
  const candles = useMemo(
    () =>
      computeCandles(
        days.map(b => ({ ...b, label: chartDayLabel(b.key) })),
        adjByDate,
      ),
    [days, adjByDate],
  )

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
      { label: '🥚 meh', trades: filtered.filter(t => t.rating === 'meh') },
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

  // Writes the user-facing change back to URL params. If a field matches the
  // current-month default, we drop it so the URL stays clean on the default view.
  function update(next: Partial<TradeFilters>) {
    const now = new Date()
    const defaultFrom = format(startOfMonth(now), 'yyyy-MM-dd')
    const defaultTo = format(endOfMonth(now), 'yyyy-MM-dd')
    const merged: TradeFilters = { ...urlFilters, ...next }
    if (merged.from === defaultFrom) merged.from = null
    if (merged.to === defaultTo) merged.to = null
    setParams(paramsFromFilters(merged))
  }

  // "Clear" returns to the bare /stats URL — which resolves to the current month.
  function clear() {
    setParams(paramsFromFilters(EMPTY_FILTERS))
  }

  const isDefault = params.toString() === ''

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
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

      <StatsGrid stats={stats} />

      {filtered.length > 0 ? (
        <>
          {equityView === 'curve' ? (
            <EquityCurve
              points={equityPoints}
              cumulative
              xTicks={xTicks}
              headerRight={<EquityChartToggle value={equityView} onChange={setEquityView} />}
            />
          ) : (
            <CandlestickChart
              points={candles}
              xTicks={xTicks}
              headerRight={<EquityChartToggle value={equityView} onChange={setEquityView} />}
            />
          )}
          <FeesChart points={candles} xTicks={xTicks} />
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
