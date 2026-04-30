import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import { firstExecutionMs } from '@/lib/trade-math'
import { aggregate } from '@/lib/trade-stats'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { DayNewsSection } from '@/components/DayNewsSection'
import { DayScreenshotSection } from '@/components/DayScreenshotSection'
import { PageHeader } from '@/components/PageHeader'
import { StatsGrid } from '@/components/StatsGrid'
import { TradeTable } from '@/components/TradeTable'

export function DayRoute() {
  const { date = '' } = useParams()
  const navigate = useNavigate()
  const parsed = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISO(date) : null
  const pretty = parsed ? format(parsed, 'EEEE, MMMM d, yyyy') : date

  const accountId = useActiveAccountId()
  const trades = useLiveQuery(
    async () => {
      const rows = await db.trades
        .where('[account_id+trade_date]')
        .equals([accountId, date])
        .toArray()
      const sortKey = (t: typeof rows[number]) =>
        firstExecutionMs(t) ?? Date.parse(t.created_at)
      return rows.sort((a, b) => sortKey(a) - sortKey(b))
    },
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

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="pt-1 space-y-8">
      <PageHeader
        title={pretty}
        prev={prevDate ? `/day/${prevDate}` : null}
        next={nextDate ? `/day/${nextDate}` : null}
        prevLabel="Previous day with trades"
        nextLabel="Next day with trades"
        rightSlot={
          <Link
            to={`/trade/new?date=${date}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-(--radius) bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90"
          >
            <Plus className="size-4" /> New trade
          </Link>
        }
      />

      <StatsGrid stats={stats} />

      <DayNewsSection date={date} />

      <DayScreenshotSection accountId={accountId} date={date} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Trades{' '}
          <span className="text-(--color-text-dim) font-normal">
            ({trades?.length ?? 0})
          </span>{' '}
          <span className="text-(--color-win) font-normal">{stats.wins}W</span>{' '}
          <span className="text-(--color-loss) font-normal">{stats.losses}L</span>
        </h2>
        {trades && trades.length > 0 ? (
          <TradeTable
            trades={trades}
            expandedIds={expandedIds}
            onToggle={toggleExpanded}
          />
        ) : (
          <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
            No trades on this day yet.
          </div>
        )}
      </section>
    </div>
  )
}
