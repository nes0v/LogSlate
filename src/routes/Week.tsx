import { useMemo } from 'react'
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
import { StatsGrid } from '@/components/StatsGrid'
import { EquityCurve } from '@/components/EquityCurve'
import { CandlestickChart } from '@/components/CandlestickChart'
import { FeesChart } from '@/components/FeesChart'
import { PeriodBreakdown } from '@/components/PeriodBreakdown'
import { PeriodNav } from '@/components/PeriodNav'

export function WeekRoute() {
  const { start } = useParams()
  const navigate = useNavigate()
  const weekStart = parseWeekStart(start)
  const { start: ws, end: we } = weekBounds(weekStart)
  const wsKey = format(ws, 'yyyy-MM-dd')
  const weKey = format(we, 'yyyy-MM-dd')
  const accountId = useActiveAccountId()

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
  const days = useMemo(() => bucketByDay(trades ?? [], ws, we), [trades, ws, we])
  const adjByDate = useMemo(() => adjustmentsByDate(adjustments ?? []), [adjustments])
  const points = useMemo(
    () =>
      days.map(b => ({
        key: b.key,
        label: b.label,
        pnl: aggregate(b.trades).net_pnl + (adjByDate.get(b.key) ?? 0),
        count: b.trades.length,
      })),
    [days, adjByDate],
  )
  const candles = useMemo(() => computeCandles(days, adjByDate), [days, adjByDate])

  function go(date: Date) {
    navigate(`/week/${format(startOfWeek(date, WEEK_OPTS), 'yyyy-MM-dd')}`)
  }

  return (
    <div className="space-y-6">
      <PeriodNav
        title={`${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`}
        onPrev={() => go(addWeek(weekStart, -1))}
        onNext={() => go(addWeek(weekStart, 1))}
        onToday={() => go(new Date())}
      />
      <StatsGrid stats={stats} />
      <EquityCurve points={points} cumulative />
      <CandlestickChart points={candles} />
      <FeesChart points={candles} />
      <PeriodBreakdown title="Daily" buckets={days} />
    </div>
  )
}
