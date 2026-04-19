import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { X } from 'lucide-react'
import type { ContractType, Rating, Session, SymbolKey } from '@/db/types'
import { db } from '@/db/schema'
import { deleteTrade } from '@/db/queries'
import {
  applyFilters,
  EMPTY_FILTERS,
  filtersFromParams,
  hasAnyFilter,
  paramsFromFilters,
  type TradeFilters,
} from '@/lib/filters'
import { aggregate, computeCandles } from '@/lib/trade-stats'
import { bucketByDay } from '@/lib/buckets'
import { StatsGrid } from '@/components/StatsGrid'
import { EquityCurve } from '@/components/EquityCurve'
import { CandlestickChart } from '@/components/CandlestickChart'
import { FacetBreakdown } from '@/components/FacetBreakdown'
import { TradeRow } from '@/components/TradeRow'
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
  const filters = filtersFromParams(params)
  const activeFilters = hasAnyFilter(filters)

  const allTrades = useLiveQuery(() => db.trades.orderBy('trade_date').toArray(), [], [])

  const filtered = useMemo(() => applyFilters(allTrades ?? [], filters), [allTrades, filters])

  const stats = aggregate(filtered)

  // Bucket trades by day across the filtered range for charts.
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (filtered.length === 0) return { rangeStart: null, rangeEnd: null }
    const dates = filtered.map(t => t.trade_date).sort()
    return { rangeStart: dates[0], rangeEnd: dates[dates.length - 1] }
  }, [filtered])

  const days = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    return bucketByDay(filtered, new Date(rangeStart + 'T00:00:00'), new Date(rangeEnd + 'T00:00:00'))
  }, [filtered, rangeStart, rangeEnd])

  const equityPoints = useMemo(
    () => days.map(b => ({ key: b.key, label: format(new Date(b.key + 'T00:00:00'), 'MMM d'), pnl: aggregate(b.trades).net_pnl })),
    [days],
  )
  const candles = useMemo(
    () =>
      computeCandles(
        days.map(b => ({ ...b, label: format(new Date(b.key + 'T00:00:00'), 'MMM d') })),
      ),
    [days],
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

  // Show trade list newest first.
  const tradesDesc = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        if (a.trade_date !== b.trade_date) return a.trade_date > b.trade_date ? -1 : 1
        return a.created_at > b.created_at ? -1 : 1
      }),
    [filtered],
  )

  function update(next: Partial<TradeFilters>) {
    const merged = { ...filters, ...next }
    setParams(paramsFromFilters(merged))
  }

  function clear() {
    setParams(paramsFromFilters(EMPTY_FILTERS))
  }

  async function handleDelete(id: string) {
    await deleteTrade(id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Stats</h1>
        {activeFilters && (
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
          <EquityCurve points={equityPoints} cumulative />
          <CandlestickChart points={candles} />
          <div className="grid md:grid-cols-2 gap-4">
            <FacetBreakdown title="By Symbol" items={bySymbol} />
            <FacetBreakdown title="By Contract" items={byContract} />
            <FacetBreakdown title="By Session" items={bySession} />
            <FacetBreakdown title="By Rating" items={byRating} />
          </div>
          <section>
            <h2 className="text-sm font-medium mb-2">
              Trades <span className="text-(--color-text-dim) font-normal">({filtered.length})</span>
            </h2>
            <div className="space-y-1.5">
              {tradesDesc.map(t => (
                <TradeRow key={t.id} trade={t} onDelete={handleDelete} />
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
