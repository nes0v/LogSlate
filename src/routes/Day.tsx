import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { ArrowUpDown, Plus } from 'lucide-react'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import { aggregate } from '@/lib/trade-stats'
import { isReversal } from '@/lib/trade-math'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { DayScreenshotSection } from '@/components/DayScreenshotSection'
import { ExpandableTradeRow } from '@/components/ExpandableTradeRow'
import { PageHeader } from '@/components/PageHeader'
import { StatsGrid } from '@/components/StatsGrid'

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
      const firstExec = (t: typeof rows[number]) => {
        let min = Infinity
        for (const e of t.executions) {
          const ms = Date.parse(e.time)
          if (!Number.isNaN(ms) && ms < min) min = ms
        }
        return min === Infinity ? Date.parse(t.created_at) : min
      }
      return rows.sort((a, b) => firstExec(a) - firstExec(b))
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

      <DayScreenshotSection accountId={accountId} date={date} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Trades{' '}
          <span className="text-(--color-text-dim) font-normal">
            ({trades?.length ?? 0})
          </span>
        </h2>
        {trades && trades.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {trades.map((t, i) => {
              const prev = i > 0 ? trades[i - 1] : null
              const reversed = prev ? isReversal(prev, t) : false
              return (
                <Fragment key={t.id}>
                  {reversed && <ReversalConnector price={t.executions[0]?.price} />}
                  <ExpandableTradeRow
                    trade={t}
                    index={i + 1}
                    expanded={expandedIds.has(t.id)}
                    onToggle={() => toggleExpanded(t.id)}
                  />
                </Fragment>
              )
            })}
          </div>
        ) : (
          <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
            No trades on this day yet.
          </div>
        )}
      </section>
    </div>
  )
}

function ReversalConnector({ price }: { price?: number }) {
  return (
    <div className="flex items-center gap-2 px-3 text-(--color-text-dim)" title="Position reversed">
      <div className="h-px flex-1 bg-(--color-border)" />
      <ArrowUpDown className="size-3.5" />
      <span className="text-xs uppercase tracking-wider">
        Reversed{price !== undefined ? ` @ ${price}` : ''}
      </span>
      <div className="h-px flex-1 bg-(--color-border)" />
    </div>
  )
}
