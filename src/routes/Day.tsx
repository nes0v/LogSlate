import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { Plus, ChevronLeft } from 'lucide-react'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import { aggregate } from '@/lib/trade-stats'
import { useStartingEquity } from '@/lib/use-starting-equity'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { DayScreenshotSection } from '@/components/DayScreenshotSection'
import { DayTradeCard } from '@/components/DayTradeCard'
import { NavArrow } from '@/components/NavArrow'
import { StatsGrid } from '@/components/StatsGrid'

export function DayRoute() {
  const { date = '' } = useParams()
  const navigate = useNavigate()
  const parsed = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISO(date) : null
  const pretty = parsed ? format(parsed, 'EEEE, MMMM d, yyyy') : date

  const accountId = useActiveAccountId()
  const trades = useLiveQuery(
    () =>
      db.trades
        .where('[account_id+trade_date]')
        .equals([accountId, date])
        .sortBy('created_at'),
    [date, accountId],
    [],
  )

  // Every distinct day that has trades for this account — used to skip empty
  // days in prev/next navigation. `uniqueKeys()` walks the compound index
  // without pulling trade rows into memory, so this stays cheap even with
  // hundreds of trades.
  const tradingDays = useLiveQuery(
    async () => {
      const keys = await db.trades
        .where('[account_id+trade_date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .uniqueKeys()
      return keys.map(k => (k as unknown as [string, string])[1])
    },
    [accountId],
    [] as string[],
  )

  const { prevDate, nextDate } = useMemo(() => {
    const list = tradingDays ?? []
    let prev: string | null = null
    let next: string | null = null
    for (const d of list) {
      if (d < date) prev = d
      else if (d > date && next === null) next = d
    }
    return { prevDate: prev, nextDate: next }
  }, [tradingDays, date])

  useArrowNavigation({
    prev: prevDate ? `/day/${prevDate}` : null,
    next: nextDate ? `/day/${nextDate}` : null,
    navigate,
  })

  const stats = aggregate(trades ?? [])
  const startingEquity = useStartingEquity(date || null)
  const roi = startingEquity > 0 ? stats.net_pnl / startingEquity : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
            aria-label="Back to calendar"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">{pretty}</h1>
          <div className="flex items-center gap-1 ml-2">
            <NavArrow
              to={prevDate ? `/day/${prevDate}` : null}
              direction="prev"
              label="Previous day with trades"
            />
            <NavArrow
              to={nextDate ? `/day/${nextDate}` : null}
              direction="next"
              label="Next day with trades"
            />
          </div>
        </div>
        <Link
          to={`/trade/new?date=${date}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-(--color-accent) text-white hover:opacity-90"
        >
          <Plus className="size-4" /> New trade
        </Link>
      </div>

      <StatsGrid stats={stats} roi={roi} />

      <DayScreenshotSection accountId={accountId} date={date} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Trades{' '}
          <span className="text-(--color-text-dim) font-normal">
            ({trades?.length ?? 0})
          </span>
        </h2>
        {trades && trades.length > 0 ? (
          <div className="flex flex-col gap-3">
            {trades.map((t, i) => (
              <DayTradeCard key={t.id} trade={t} index={i + 1} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-md">
            No trades on this day yet.
          </div>
        )}
      </section>
    </div>
  )
}
