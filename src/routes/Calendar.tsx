import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import { useActiveAccountId } from '@/lib/active-account'
import { effectivePnl } from '@/lib/trade-math'
import { formatUsd } from '@/lib/money'
import { parseYearMonth, WEEK_OPTS } from '@/lib/buckets'
import { ForexFactoryNews } from '@/components/ForexFactoryNews'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

const DATE_KEY = 'yyyy-MM-dd'

export function CalendarRoute() {
  const { ym } = useParams()

  // Memoize date derivations so `useMemo` deps compare by stable reference.
  const { month, gridStart, gridEnd, days } = useMemo(() => {
    const month = parseYearMonth(ym)
    const ms = startOfMonth(month)
    const me = endOfMonth(month)
    const gridStart = startOfWeek(ms, WEEK_OPTS)
    const gridEnd = endOfWeek(me, WEEK_OPTS)
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd })
    return { month, gridStart, gridEnd, days }
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
        <div className="grid grid-cols-7 gap-px bg-(--color-border) rounded-(--radius) overflow-hidden shadow-(--shadow-xs)">
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
                        ? 'bg-(--color-accent) text-(--color-accent-fg) rounded-sm size-5 flex items-center justify-center font-semibold'
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
      </div>
    </div>
  )
}
