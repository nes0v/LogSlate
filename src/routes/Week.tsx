import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, startOfWeek } from 'date-fns'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import {
  addWeek,
  bucketByDay,
  parseWeekStart,
  weekBounds,
  WEEK_OPTS,
} from '@/lib/buckets'
import { adjustmentsByDate, aggregate, computeCandles } from '@/lib/trade-stats'
import { useStartingEquity } from '@/lib/use-starting-equity'
import { StatsGrid } from '@/components/StatsGrid'
import { EquityCurve } from '@/components/EquityCurve'
import { CandlestickChart } from '@/components/CandlestickChart'
import { FeesChart } from '@/components/FeesChart'
import { EquityChartToggle, type EquityView } from '@/components/EquityChartToggle'
import { PeriodBreakdown } from '@/components/PeriodBreakdown'
import { PeriodNav } from '@/components/PeriodNav'
import { TradeRow, TRADE_ROW_COLS } from '@/components/TradeRow'
import { cn } from '@/lib/utils'

export function WeekRoute() {
  const { start } = useParams()
  const navigate = useNavigate()
  const weekStart = parseWeekStart(start)
  const { start: ws, end: we } = weekBounds(weekStart)
  const wsKey = format(ws, 'yyyy-MM-dd')
  const weKey = format(we, 'yyyy-MM-dd')
  const accountId = useActiveAccountId()
  const [equityView, setEquityView] = useState<EquityView>('curve')

  const trades = useLiveQuery(
    () =>
      db.trades
        .where('[account_id+trade_date]')
        .between([accountId, wsKey], [accountId, weKey], true, true)
        .toArray(),
    [wsKey, weKey, accountId],
    [],
  )
  const adjustments = useLiveQuery(
    () =>
      db.adjustments
        .where('[account_id+date]')
        .between([accountId, wsKey], [accountId, weKey], true, true)
        .toArray(),
    [wsKey, weKey, accountId],
    [],
  )

  const stats = aggregate(trades ?? [])
  const startingEquity = useStartingEquity(wsKey)
  const roi = startingEquity > 0 ? stats.net_pnl / startingEquity : null
  const days = useMemo(() => bucketByDay(trades ?? [], ws, we), [trades, ws, we])
  const adjByDate = useMemo(() => adjustmentsByDate(adjustments ?? []), [adjustments])
  const xTicks = useMemo(() => days.map(b => b.key), [days])
  const equityPoints = useMemo(
    () =>
      days.map(b => ({
        key: b.key,
        label: b.key,
        pnl: aggregate(b.trades).net_pnl + (adjByDate.get(b.key) ?? 0),
        count: b.trades.length,
      })),
    [days, adjByDate],
  )
  const candles = useMemo(
    () => computeCandles(days.map(b => ({ ...b, label: b.key })), adjByDate, startingEquity),
    [days, adjByDate, startingEquity],
  )
  const adjustmentMarkers = useMemo(
    () =>
      Array.from(adjByDate.entries())
        .filter(([date]) => days.some(b => b.key === date))
        .map(([date, amount]) => ({ x: date, amount })),
    [adjByDate, days],
  )

  const tradesAsc = useMemo(() => {
    const list = trades ?? []
    function firstExec(t: typeof list[number]): number {
      let min = Infinity
      for (const e of t.executions) {
        const ms = Date.parse(e.time)
        if (!Number.isNaN(ms) && ms < min) min = ms
      }
      return min === Infinity ? 0 : min
    }
    return [...list].sort((a, b) => {
      if (a.trade_date !== b.trade_date) return a.trade_date < b.trade_date ? -1 : 1
      return firstExec(a) - firstExec(b)
    })
  }, [trades])

  function go(date: Date) {
    navigate(`/week/${format(startOfWeek(date, WEEK_OPTS), 'yyyy-MM-dd')}`)
  }

  const hasTrades = (trades?.length ?? 0) > 0

  return (
    <div className="space-y-8">
      <PeriodNav
        title={`${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`}
        onPrev={() => go(addWeek(weekStart, -1))}
        onNext={() => go(addWeek(weekStart, 1))}
        onToday={() => go(new Date())}
      />
      <StatsGrid stats={stats} roi={roi} />

      {hasTrades ? (
        <>
          {equityView === 'curve' ? (
            <EquityCurve
              points={equityPoints}
              cumulative
              startEquity={startingEquity}
              xTicks={xTicks}
              adjustments={adjustmentMarkers}
              onPointClick={key => navigate(`/day/${key}`)}
              headerRight={<EquityChartToggle value={equityView} onChange={setEquityView} />}
            />
          ) : (
            <CandlestickChart
              points={candles}
              xTicks={xTicks}
              adjustments={adjustmentMarkers}
              onPointClick={key => navigate(`/day/${key}`)}
              headerRight={<EquityChartToggle value={equityView} onChange={setEquityView} />}
            />
          )}
          <FeesChart points={candles} xTicks={xTicks} />
          <PeriodBreakdown title="Days" buckets={days} />
          <section>
            <h2 className="text-sm font-medium mb-2">
              Trades <span className="text-(--color-text-dim) font-normal">({tradesAsc.length})</span>
            </h2>
            <div className={cn('grid gap-x-5 gap-y-1.5', TRADE_ROW_COLS)}>
              {tradesAsc.map((t, i) => (
                <TradeRow key={t.id} trade={t} index={i + 1} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-md">
          No trades this week.
        </div>
      )}
    </div>
  )
}
