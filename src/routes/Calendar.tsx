import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parse,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { db } from '@/db/schema'
import { effectivePnl } from '@/lib/trade-math'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

const MONTH_PARAM_FORMAT = 'yyyy-MM'
const DATE_KEY_FORMAT = 'yyyy-MM-dd'
// Sunday-start weeks (US convention for futures traders).
const WEEK_OPTS = { weekStartsOn: 0 as const }

function parseMonthParam(raw: string | null): Date {
  if (raw) {
    const d = parse(raw, MONTH_PARAM_FORMAT, new Date())
    if (!Number.isNaN(d.getTime())) return startOfMonth(d)
  }
  return startOfMonth(new Date())
}

export function CalendarRoute() {
  const [params, setParams] = useSearchParams()
  const month = parseMonthParam(params.get('month'))

  const gridStart = startOfWeek(startOfMonth(month), WEEK_OPTS)
  const gridEnd = endOfWeek(endOfMonth(month), WEEK_OPTS)
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const rangeStart = format(gridStart, DATE_KEY_FORMAT)
  const rangeEnd = format(gridEnd, DATE_KEY_FORMAT)

  const trades = useLiveQuery(
    () => db.trades.where('trade_date').between(rangeStart, rangeEnd, true, true).toArray(),
    [rangeStart, rangeEnd],
    [],
  )

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

  function navMonth(dir: -1 | 1) {
    const next = dir === -1 ? subMonths(month, 1) : addMonths(month, 1)
    setParams({ month: format(next, MONTH_PARAM_FORMAT) })
  }

  function goToday() {
    setParams({ month: format(new Date(), MONTH_PARAM_FORMAT) })
  }

  const weekdayLabels = useMemo(() => {
    const first = gridStart
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(first)
      d.setDate(d.getDate() + i)
      return format(d, 'EEE')
    })
  }, [gridStart])

  const monthTotal = useMemo(() => {
    let sum = 0
    for (const t of trades ?? []) {
      if (isSameMonth(parse(t.trade_date, DATE_KEY_FORMAT, new Date()), month)) {
        sum += effectivePnl(t) ?? 0
      }
    }
    return sum
  }, [trades, month])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navMonth(-1)}
            aria-label="Previous month"
            className="p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <ChevronLeft className="size-4" />
          </button>
          <h1 className="text-lg font-semibold min-w-40 text-center">
            {format(month, 'MMMM yyyy')}
          </h1>
          <button
            onClick={() => navMonth(1)}
            aria-label="Next month"
            className="p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            onClick={goToday}
            className="ml-2 px-2 py-1 text-xs rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
          >
            Today
          </button>
        </div>
        <div className="text-sm">
          <span className="text-(--color-text-dim) mr-2">Month net</span>
          <span
            className={cn(
              'font-mono',
              monthTotal > 0 && 'text-(--color-win)',
              monthTotal < 0 && 'text-(--color-loss)',
              monthTotal === 0 && 'text-(--color-text-dim)',
            )}
          >
            {formatUsd(monthTotal)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-(--color-border) border border-(--color-border) rounded-md overflow-hidden">
        {weekdayLabels.map((lbl) => (
          <div
            key={lbl}
            className="bg-(--color-panel) text-xs text-(--color-text-dim) text-center py-2"
          >
            {lbl}
          </div>
        ))}
        {days.map((d) => {
          const key = format(d, DATE_KEY_FORMAT)
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
    </div>
  )
}
