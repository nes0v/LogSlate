import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { db } from '@/db/schema'
import { effectivePnl } from '@/lib/trade-math'
import { formatUsd } from '@/lib/money'
import { bucketByDay, chartDayLabel, parseYearMonth, WEEK_OPTS } from '@/lib/buckets'
import { adjustmentsByDate, aggregate, computeCandles } from '@/lib/trade-stats'
import { CandlestickChart } from '@/components/CandlestickChart'
import { EquityChartToggle, type EquityView } from '@/components/EquityChartToggle'
import { EquityCurve } from '@/components/EquityCurve'
import { FeesChart } from '@/components/FeesChart'
import { PeriodNav } from '@/components/PeriodNav'
import { cn } from '@/lib/utils'

const DATE_KEY = 'yyyy-MM-dd'

export function CalendarRoute() {
  const { ym } = useParams()
  const navigate = useNavigate()
  const [equityView, setEquityView] = useState<EquityView>('curve')

  // Memoize date derivations so `useMemo` deps compare by stable reference.
  const { month, ms, me, gridStart, gridEnd, days } = useMemo(() => {
    const month = parseYearMonth(ym)
    const ms = startOfMonth(month)
    const me = endOfMonth(month)
    const gridStart = startOfWeek(ms, WEEK_OPTS)
    const gridEnd = endOfWeek(me, WEEK_OPTS)
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd })
    return { month, ms, me, gridStart, gridEnd, days }
  }, [ym])

  const rangeStart = format(gridStart, DATE_KEY)
  const rangeEnd = format(gridEnd, DATE_KEY)

  const trades = useLiveQuery(
    () => db.trades.where('trade_date').between(rangeStart, rangeEnd, true, true).toArray(),
    [rangeStart, rangeEnd],
    [],
  )

  const monthStartKey = format(ms, DATE_KEY)
  const monthEndKey = format(me, DATE_KEY)
  const monthTrades = useLiveQuery(
    () =>
      db.trades.where('trade_date').between(monthStartKey, monthEndKey, true, true).toArray(),
    [monthStartKey, monthEndKey],
    [],
  )
  const monthAdjustments = useLiveQuery(
    () =>
      db.adjustments.where('date').between(monthStartKey, monthEndKey, true, true).toArray(),
    [monthStartKey, monthEndKey],
    [],
  )

  // Per-day map for the grid (spans padded out-of-month days).
  const perDay = useMemo(() => {
    const m = new Map<string, { pnl: number; count: number }>()
    for (const t of trades ?? []) {
      const pnl = effectivePnl(t) ?? 0
      const cur = m.get(t.trade_date) ?? { pnl: 0, count: 0 }
      cur.pnl += pnl
      cur.count += 1
      m.set(t.trade_date, cur)
    }
    return m
  }, [trades])

  // Running total for the "Month net" indicator in the header.
  const monthNet = useMemo(() => {
    let total = 0
    for (const t of trades ?? []) {
      if (isSameMonth(new Date(t.trade_date + 'T00:00:00'), month)) {
        total += effectivePnl(t) ?? 0
      }
    }
    return total
  }, [trades, month])

  function go(d: Date) {
    navigate(`/month/${format(d, 'yyyy-MM')}`)
  }

  // Day buckets across the month, extended by 1 so charts show the first of
  // the next month as the right edge.
  const dayBuckets = useMemo(() => {
    return bucketByDay(monthTrades ?? [], ms, addDays(me, 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthTrades, monthStartKey, monthEndKey])

  const adjByDate = useMemo(
    () => adjustmentsByDate(monthAdjustments ?? []),
    [monthAdjustments],
  )

  const xTicks = useMemo(() => dayBuckets.map(b => chartDayLabel(b.key)), [dayBuckets])

  const equityPoints = useMemo(
    () =>
      dayBuckets.map(b => ({
        key: b.key,
        label: chartDayLabel(b.key),
        pnl: aggregate(b.trades).net_pnl + (adjByDate.get(b.key) ?? 0),
        count: b.trades.length,
      })),
    [dayBuckets, adjByDate],
  )
  const candles = useMemo(
    () =>
      computeCandles(
        dayBuckets.map(b => ({ ...b, label: chartDayLabel(b.key) })),
        adjByDate,
      ),
    [dayBuckets, adjByDate],
  )

  const adjustmentMarkers = useMemo(
    () =>
      Array.from(adjByDate.entries())
        .filter(([date]) => dayBuckets.some(b => b.key === date))
        .map(([date, amount]) => ({ x: chartDayLabel(date), amount })),
    [adjByDate, dayBuckets],
  )

  const weekdayLabels = useMemo(() => {
    const first = gridStart
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(first)
      d.setDate(d.getDate() + i)
      return format(d, 'EEE')
    })
  }, [gridStart])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <PeriodNav
          title={format(month, 'MMMM yyyy')}
          onPrev={() => go(subMonths(month, 1))}
          onNext={() => go(addMonths(month, 1))}
          onToday={() => go(new Date())}
        />
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-(--color-text-dim)">Month net</span>
          <span
            className={cn(
              'text-base font-mono',
              monthNet > 0 && 'text-(--color-win)',
              monthNet < 0 && 'text-(--color-loss)',
              monthNet === 0 && 'text-(--color-text-dim)',
            )}
          >
            {formatUsd(monthNet)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-(--color-border) border border-(--color-border) rounded-md overflow-hidden mb-20">
        {weekdayLabels.map(lbl => (
          <div
            key={lbl}
            className="bg-(--color-panel) text-xs text-(--color-text-dim) text-center py-2"
          >
            {lbl}
          </div>
        ))}
        {days.map(d => {
          const key = format(d, DATE_KEY)
          const cell = perDay.get(key)
          const inMonth = isSameMonth(d, month)
          const today = isToday(d)
          return (
            <Link
              key={key}
              to={`/day/${key}`}
              className={cn(
                'bg-(--color-panel) hover:bg-(--color-panel-2) transition-colors',
                'min-h-20 sm:min-h-24 p-2 flex flex-col gap-1',
                !inMonth && 'opacity-40',
              )}
            >
              <div className="flex items-center">
                <span
                  className={cn(
                    'text-xs',
                    today
                      ? 'bg-(--color-accent) text-white rounded-sm size-5 flex items-center justify-center font-semibold'
                      : 'text-(--color-text-dim)',
                  )}
                >
                  {format(d, 'd')}
                </span>
              </div>
              {cell ? (
                <div className="mt-auto">
                  <div
                    className={cn(
                      'text-base font-mono font-medium',
                      cell.pnl > 0 && 'text-(--color-win)',
                      cell.pnl < 0 && 'text-(--color-loss)',
                      cell.pnl === 0 && 'text-(--color-text-dim)',
                    )}
                  >
                    {formatUsd(cell.pnl)}
                  </div>
                  <div className="text-xs text-(--color-text-dim) font-normal">
                    {cell.count} trade{cell.count === 1 ? '' : 's'}
                  </div>
                </div>
              ) : null}
            </Link>
          )
        })}
      </div>

      {equityView === 'curve' ? (
        <EquityCurve
          points={equityPoints}
          cumulative
          xTicks={xTicks}
          adjustments={adjustmentMarkers}
          headerRight={<EquityChartToggle value={equityView} onChange={setEquityView} />}
        />
      ) : (
        <CandlestickChart
          points={candles}
          xTicks={xTicks}
          adjustments={adjustmentMarkers}
          headerRight={<EquityChartToggle value={equityView} onChange={setEquityView} />}
        />
      )}
      <FeesChart points={candles} xTicks={xTicks} />
    </div>
  )
}
