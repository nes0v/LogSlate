import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addYears, format } from 'date-fns'
import { db } from '@/db/schema'
import { bucketByMonth, bucketByWeek, parseYear, yearBounds } from '@/lib/buckets'
import { aggregate, computeCandles } from '@/lib/trade-stats'
import { StatsGrid } from '@/components/StatsGrid'
import { EquityCurve } from '@/components/EquityCurve'
import { CandlestickChart } from '@/components/CandlestickChart'
import { PeriodBreakdown } from '@/components/PeriodBreakdown'
import { PeriodNav } from '@/components/PeriodNav'
import { Pills } from '@/components/form/Pills'

type BreakdownBy = 'months' | 'weeks'

const BY_OPTIONS = [
  { value: 'months' as const, label: 'Months' },
  { value: 'weeks' as const, label: 'Weeks' },
]

export function YearRoute() {
  const { year } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const by: BreakdownBy = params.get('by') === 'weeks' ? 'weeks' : 'months'

  const yearStart = parseYear(year)
  const { start: ys, end: ye } = yearBounds(yearStart)
  const ysKey = format(ys, 'yyyy-MM-dd')
  const yeKey = format(ye, 'yyyy-MM-dd')

  const trades = useLiveQuery(
    () => db.trades.where('trade_date').between(ysKey, yeKey, true, true).toArray(),
    [ysKey, yeKey],
    [],
  )

  const stats = aggregate(trades ?? [])
  const months = useMemo(() => bucketByMonth(trades ?? [], ys, ye), [trades, ys, ye])
  const weeks = useMemo(() => bucketByWeek(trades ?? [], ys, ye), [trades, ys, ye])

  // Equity curve always follows the breakdown granularity.
  const activeBuckets = by === 'weeks' ? weeks : months
  const points = useMemo(
    () =>
      activeBuckets.map(b => ({
        key: b.key,
        label: b.label,
        pnl: aggregate(b.trades).net_pnl,
      })),
    [activeBuckets],
  )
  const candles = useMemo(() => computeCandles(activeBuckets), [activeBuckets])

  function go(d: Date) {
    // Preserve the `by` param across year navigation.
    const next = new URLSearchParams(params)
    navigate({ pathname: `/year/${format(d, 'yyyy')}`, search: next.toString() })
  }

  function changeBy(next: BreakdownBy) {
    const p = new URLSearchParams(params)
    if (next === 'months') p.delete('by')
    else p.set('by', next)
    setParams(p)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PeriodNav
          title={format(ys, 'yyyy')}
          onPrev={() => go(addYears(yearStart, -1))}
          onNext={() => go(addYears(yearStart, 1))}
          onToday={() => go(new Date())}
        />
        <Pills value={by} onChange={changeBy} options={BY_OPTIONS} />
      </div>
      <StatsGrid stats={stats} />
      <EquityCurve points={points} cumulative />
      <CandlestickChart points={candles} />
      <PeriodBreakdown title={by === 'weeks' ? 'Weekly' : 'Monthly'} buckets={activeBuckets} />
    </div>
  )
}
