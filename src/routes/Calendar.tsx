import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
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
import { aggregate, computeCandles } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { bucketByDay, bucketByWeek, parseYearMonth, WEEK_OPTS } from '@/lib/buckets'
import { StatsGrid } from '@/components/StatsGrid'
import { EquityCurve } from '@/components/EquityCurve'
import { CandlestickChart } from '@/components/CandlestickChart'
import { FeesChart } from '@/components/FeesChart'
import { PeriodBreakdown } from '@/components/PeriodBreakdown'
import { PeriodNav } from '@/components/PeriodNav'
import { cn } from '@/lib/utils'

const DATE_KEY = 'yyyy-MM-dd'

export function CalendarRoute() {
  const { ym } = useParams()
  const navigate = useNavigate()
  const month = parseYearMonth(ym)

  const ms = startOfMonth(month)
  const me = endOfMonth(month)
  const gridStart = startOfWeek(ms, WEEK_OPTS)
  const gridEnd = endOfWeek(me, WEEK_OPTS)
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const rangeStart = format(gridStart, DATE_KEY)
  const rangeEnd = format(gridEnd, DATE_KEY)

  const trades = useLiveQuery(
    () => db.trades.where('trade_date').between(rangeStart, rangeEnd, true, true).toArray(),
    [rangeStart, rangeEnd],
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

  // Aggregates below the grid only consider trades in the current month.
  const monthTrades = useMemo(
    () => (trades ?? []).filter(t => isSameMonth(new Date(t.trade_date + 'T00:00:00'), month)),
    [trades, month],
  )
  const monthStats = aggregate(monthTrades)
  const dayBuckets = useMemo(() => bucketByDay(monthTrades, ms, me), [monthTrades, ms, me])
  const weekBuckets = useMemo(() => bucketByWeek(monthTrades, ms, me), [monthTrades, ms, me])
  const equityPoints = useMemo(
    () =>
      dayBuckets.map(b => ({
        key: b.key,
        label: format(new Date(b.key + 'T00:00:00'), 'd'),
        pnl: aggregate(b.trades).net_pnl,
      })),
    [dayBuckets],
  )
  const candles = useMemo(
    () =>
      computeCandles(
        dayBuckets.map(b => ({
          ...b,
          label: format(new Date(b.key + 'T00:00:00'), 'd'),
        })),
      ),
    [dayBuckets],
  )

  function go(d: Date) {
    navigate(`/month/${format(d, 'yyyy-MM')}`)
  }

  const weekdayLabels = useMemo(() => {
    const first = gridStart
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(first)
      d.setDate(d.getDate() + i)
      return format(d, 'EEE')
    })
  }, [gridStart])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PeriodNav
          title={format(month, 'MMMM yyyy')}
          onPrev={() => go(subMonths(month, 1))}
          onNext={() => go(addMonths(month, 1))}
          onToday={() => go(new Date())}
        />
        <div className="text-sm">
          <span className="text-(--color-text-dim) mr-2">Month net</span>
          <span
            className={cn(
              'font-mono',
              monthStats.net_pnl > 0 && 'text-(--color-win)',
              monthStats.net_pnl < 0 && 'text-(--color-loss)',
              monthStats.net_pnl === 0 && 'text-(--color-text-dim)',
            )}
          >
            {formatUsd(monthStats.net_pnl)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-(--color-border) border border-(--color-border) rounded-md overflow-hidden">
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
                      ? 'bg-(--color-accent) text-white rounded-full size-5 flex items-center justify-center'
                      : 'text-(--color-text-dim)',
                  )}
                >
                  {format(d, 'd')}
                </span>
              </div>
              {cell ? (
                <div
                  className={cn(
                    'text-sm font-mono font-medium mt-auto flex items-baseline gap-1',
                    cell.pnl > 0 && 'text-(--color-win)',
                    cell.pnl < 0 && 'text-(--color-loss)',
                    cell.pnl === 0 && 'text-(--color-text-dim)',
                  )}
                >
                  <span>{formatUsd(cell.pnl)}</span>
                  <span className="text-[10px] text-(--color-text-dim) font-normal">
                    ({cell.count} trade{cell.count === 1 ? '' : 's'})
                  </span>
                </div>
              ) : null}
            </Link>
          )
        })}
      </div>

      <StatsGrid stats={monthStats} />
      <EquityCurve points={equityPoints} cumulative />
      <CandlestickChart points={candles} />
      <FeesChart points={candles} />
      <PeriodBreakdown title="Weekly" buckets={weekBuckets} />
    </div>
  )
}
