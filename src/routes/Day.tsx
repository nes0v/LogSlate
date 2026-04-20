import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { Plus, ChevronLeft } from 'lucide-react'
import { db } from '@/db/schema'
import { aggregate } from '@/lib/trade-stats'
import { StatsGrid } from '@/components/StatsGrid'
import { TradeRow, TRADE_ROW_COLS } from '@/components/TradeRow'
import { cn } from '@/lib/utils'

export function DayRoute() {
  const { date = '' } = useParams()
  const parsed = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISO(date) : null
  const pretty = parsed ? format(parsed, 'EEEE, MMMM d, yyyy') : date

  const trades = useLiveQuery(
    () => db.trades.where('trade_date').equals(date).sortBy('created_at'),
    [date],
    [],
  )

  const stats = aggregate(trades ?? [])

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
        </div>
        <Link
          to={`/trade/new?date=${date}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-(--color-accent) text-white hover:opacity-90"
        >
          <Plus className="size-4" /> New trade
        </Link>
      </div>

      <StatsGrid stats={stats} />

      {trades && trades.length > 0 ? (
        <div className={cn('grid gap-x-5 gap-y-1.5', TRADE_ROW_COLS)}>
          {trades.map((t, i) => (
            <TradeRow key={t.id} trade={t} index={i + 1} />
          ))}
        </div>
      ) : (
        <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-md">
          No trades on this day yet.
        </div>
      )}
    </div>
  )
}
