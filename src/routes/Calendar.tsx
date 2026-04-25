import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subMonths,
} from 'date-fns'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import { effectivePnl } from '@/lib/trade-math'
import { formatUsd } from '@/lib/money'
import {
  bucketByTimeframe,
  dateToBucketKey,
  parseYearMonth,
  WEEK_OPTS,
  type Timeframe,
} from '@/lib/buckets'
import { adjustmentsByDate, computeCandles } from '@/lib/trade-stats'
import { useStartingEquity } from '@/lib/use-starting-equity'
import { bucketNavTarget } from '@/lib/stats-nav'
import { TradingViewChart } from '@/components/TradingViewChart'
import { ChartTimeframeToggle } from '@/components/ChartTimeframeToggle'
import { EquityChartToggle, type EquityView } from '@/components/EquityChartToggle'
import { getDefaultEquityView } from '@/lib/equity-view-preference'
import { ForexFactoryNews } from '@/components/ForexFactoryNews'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

const DATE_KEY = 'yyyy-MM-dd'

export function CalendarRoute() {
  const { ym } = useParams()
  const navigate = useNavigate()
  const [equityView, setEquityView] = useState<EquityView>(getDefaultEquityView)
  const [timeframe, setTimeframe] = useState<Timeframe>('D')

  // Memoize date derivations so `useMemo` deps compare by stable reference.
  const { month, me, gridStart, gridEnd, days } = useMemo(() => {
    const month = parseYearMonth(ym)
    const ms = startOfMonth(month)
    const me = endOfMonth(month)
    const gridStart = startOfWeek(ms, WEEK_OPTS)
    const gridEnd = endOfWeek(me, WEEK_OPTS)
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd })
    return { month, me, gridStart, gridEnd, days }
  }, [ym])

  const rangeStart = format(gridStart, DATE_KEY)
  const rangeEnd = format(gridEnd, DATE_KEY)
  const accountId = useActiveAccountId()

  const trades = useLiveQuery(
    () =>
      db.trades
        .where('[account_id+trade_date]')
        .between([accountId, rangeStart], [accountId, rangeEnd], true, true)
        .toArray(),
    [rangeStart, rangeEnd, accountId],
    [],
  )

  // Chart needs every trade and adjustment so the user can pan past
  // the default 30-day window. The calendar grid + month-net header
  // still read from the month-scoped `trades` query above.
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

  // Default chart viewport: 30-day window ending on the most recent
  // trade date (falls back to today). Same anchoring as Stats — so
  // both pages open showing the same time period instead of Calendar
  // narrowing the chart to just the displayed month.
  const lastTradeDate = useMemo(() => {
    const list = allTrades ?? []
    if (list.length === 0) return format(new Date(), DATE_KEY)
    let max = list[0].trade_date
    for (const t of list) if (t.trade_date > max) max = t.trade_date
    return max
  }, [allTrades])
  const defaultFromKey = useMemo(
    () => format(addDays(new Date(lastTradeDate + 'T00:00:00'), -29), DATE_KEY),
    [lastTradeDate],
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

  // Earliest trade-or-adjustment date through today (or the displayed
  // month-end if it's later) — the chart spans this whole range so the
  // user can pan past the visible month.
  const dataRange = useMemo(() => {
    const dates: string[] = []
    for (const t of allTrades ?? []) dates.push(t.trade_date)
    for (const a of allAdjustments ?? []) dates.push(a.date)
    if (dates.length === 0) return null
    dates.sort()
    const earliest = new Date(dates[0] + 'T00:00:00')
    const latest = new Date(dates[dates.length - 1] + 'T00:00:00')
    const end = latest > me ? latest : me
    return { start: earliest, end }
  }, [allTrades, allAdjustments, me])

  // Bucket-aligned variant of `dataRange` for the active timeframe so
  // each bar covers a whole period (full month for M, full quarter for
  // Q, etc.) instead of clipping the edge buckets.
  const tfChartRange = useMemo(() => {
    if (!dataRange) return null
    const { start: s, end: e } = dataRange
    switch (timeframe) {
      case 'D': return { start: s, end: e }
      case 'W': return { start: startOfWeek(s, WEEK_OPTS), end: endOfWeek(e, WEEK_OPTS) }
      case 'M': return { start: startOfMonth(s), end: endOfMonth(e) }
      case 'Q': return { start: startOfQuarter(s), end: endOfQuarter(e) }
      case 'Y': return { start: startOfYear(s), end: endOfYear(e) }
    }
  }, [dataRange, timeframe])

  const tfBuckets = useMemo(() => {
    if (!tfChartRange) return []
    return bucketByTimeframe(
      timeframe,
      allTrades ?? [],
      tfChartRange.start,
      addDays(tfChartRange.end, 1),
    )
  }, [allTrades, tfChartRange, timeframe])

  const adjByDate = useMemo(
    () => adjustmentsByDate(allAdjustments ?? []),
    [allAdjustments],
  )

  const tfAdjByBucket = useMemo(() => {
    const map = new Map<string, number>()
    for (const [dateKey, amount] of adjByDate.entries()) {
      const k = dateToBucketKey(dateKey, timeframe)
      map.set(k, (map.get(k) ?? 0) + amount)
    }
    return map
  }, [adjByDate, timeframe])

  const startingEquity = useStartingEquity(
    tfChartRange ? format(tfChartRange.start, DATE_KEY) : null,
  )
  const candles = useMemo(
    () =>
      computeCandles(
        tfBuckets.map(b => ({ ...b, label: b.key })),
        tfAdjByBucket,
        startingEquity,
      ),
    [tfBuckets, tfAdjByBucket, startingEquity],
  )

  const adjustmentMarkers = useMemo(() => {
    const keys = new Set(tfBuckets.map(b => b.key))
    const out: Array<{ x: string; amount: number }> = []
    for (const [key, amount] of tfAdjByBucket) {
      if (keys.has(key)) out.push({ x: key, amount })
    }
    return out
  }, [tfAdjByBucket, tfBuckets])


  const weekdayLabels = useMemo(() => {
    const first = gridStart
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(first)
      d.setDate(d.getDate() + i)
      return format(d, 'EEE')
    })
  }, [gridStart])

  return (
    <div>
      <PageHeader
        title={format(month, 'MMMM yyyy')}
        prev={`/month/${format(subMonths(month, 1), 'yyyy-MM')}`}
        next={`/month/${format(addMonths(month, 1), 'yyyy-MM')}`}
        prevLabel="Previous month"
        nextLabel="Next month"
        todayTo={`/month/${format(new Date(), 'yyyy-MM')}`}
        rightSlot={
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
        }
      />

      <div className="mt-6 space-y-8">
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

        <ForexFactoryNews />

        <TradingViewChart
          points={candles}
          adjustments={adjustmentMarkers}
          timeframe={timeframe}
          viewportFrom={defaultFromKey}
          viewportTo={lastTradeDate}
          onPointClick={key => navigate(bucketNavTarget(key, timeframe))}
          variant="dark"
          title="Equity and fees"
          height={698}
          view={equityView === 'curve' ? 'line' : 'candles'}
          headerRight={
            <div className="flex items-center gap-2">
              <EquityChartToggle value={equityView} onChange={setEquityView} />
              <ChartTimeframeToggle value={timeframe} onChange={setTimeframe} />
            </div>
          }
        />
      </div>
    </div>
  )
}
