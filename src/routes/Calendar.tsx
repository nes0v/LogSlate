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
import { classifyTrade, effectivePnl } from '@/lib/trade-math'
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

  // Per-day map. Wins/losses are tracked separately from `count` so a
  // day that only contains scratches renders in the dim/breakeven tone
  // instead of being miscoloured by fee/slippage residue in the PnL
  // sum. `wins` also feeds the per-day win-rate badge.
  const perDay = useMemo(() => {
    const m = new Map<string, { pnl: number; count: number; wins: number; losses: number }>()
    for (const t of trades ?? []) {
      const pnl = effectivePnl(t) ?? 0
      const cur = m.get(t.trade_date) ?? { pnl: 0, count: 0, wins: 0, losses: 0 }
      cur.pnl += pnl
      cur.count += 1
      const outcome = classifyTrade(t)
      if (outcome === 'win') cur.wins += 1
      else if (outcome === 'loss') cur.losses += 1
      m.set(t.trade_date, cur)
    }
    return m
  }, [trades])

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

  // Chunk the day grid into weekly rows + per-week PnL & traded-day
  // count, scoped to the active month so neighbouring-month padding
  // doesn't pollute the totals.
  const weeks = useMemo(() => {
    const out: Array<{ days: Date[]; pnl: number; tradedDays: number }> = []
    for (let i = 0; i < days.length; i += 7) {
      const slice = days.slice(i, i + 7)
      let pnl = 0
      let tradedDays = 0
      for (const d of slice) {
        if (!isSameMonth(d, month)) continue
        const cell = perDay.get(format(d, DATE_KEY))
        if (cell) {
          pnl += cell.pnl
          tradedDays += 1
        }
      }
      out.push({ days: slice, pnl, tradedDays })
    }
    return out
  }, [days, perDay, month])

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
                'text-lg font-mono',
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
        {/* The 4px spacer column + the surrounding 6px column-gaps give a
            16px aisle between the day grid and the weekly summary
            column, matching the gap-4 spacing used between sections on
            the new-trade page. */}
        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_4px_minmax(96px,140px)] gap-1.5">
          {weekdayLabels.map(lbl => (
            <div
              key={lbl}
              className="rounded-(--radius) border border-(--color-cal-week-border) bg-transparent text-xs font-bold text-(--color-text) text-center py-2"
            >
              {lbl}
            </div>
          ))}
          <div aria-hidden />
          <div aria-hidden />
          {weeks.flatMap((week, weekIdx) => [
            ...week.days.map(d => renderDayCell(d, weekIdx)),
            <div key={`aisle-${weekIdx}`} aria-hidden />,
            <WeekCard
              key={`week-${weekIdx}`}
              index={weekIdx + 1}
              pnl={week.pnl}
              tradedDays={week.tradedDays}
            />,
          ])}
        </div>

        <ForexFactoryNews />
      </div>
    </div>
  )

  function renderDayCell(d: Date, weekIdx: number) {
    const key = format(d, DATE_KEY)
    const cell = perDay.get(key)
    const inMonth = isSameMonth(d, month)
    const today = isToday(d)
    const decided = cell ? cell.wins + cell.losses : 0
    // A day of trades that only contains scratches falls into the dim
    // tone even when the summed PnL is technically non-zero from
    // fees/slippage residue.
    const tone: 'win' | 'loss' | 'dim' =
      !cell || decided === 0
        ? 'dim'
        : cell.pnl > 0
          ? 'win'
          : cell.pnl < 0
            ? 'loss'
            : 'dim'
    const isColoured = tone === 'win' || tone === 'loss'
    const winRate = decided > 0 ? Math.round((cell!.wins / decided) * 100) : null
    return (
      <Link
        key={`${weekIdx}-${key}`}
        to={`/day/${key}`}
        className={cn(
          'rounded border transition-colors min-h-[88px] sm:min-h-[104px] p-2 flex flex-col gap-1',
          inMonth && tone === 'win' &&
            'bg-(--color-cal-win-bg) border-(--color-cal-win-ring) hover:brightness-110',
          inMonth && tone === 'loss' &&
            'bg-(--color-cal-loss-bg) border-(--color-cal-loss-ring) hover:brightness-110',
          inMonth && tone === 'dim' && cell &&
            'bg-(--color-cal-breakeven-bg) border-(--color-cal-breakeven-ring) hover:brightness-110',
          inMonth && tone === 'dim' && !cell &&
            'bg-(--color-panel) border-transparent hover:bg-(--color-panel-2)',
          // Out-of-month days are transparent with a border matching
          // the in-month empty bg, so they read as padding rather than
          // active cells.
          !inMonth &&
            'bg-transparent border-(--color-panel) hover:bg-(--color-panel)/40 text-(--color-text-faint)',
        )}
      >
        <div className="flex items-center justify-end">
          <span
            className={cn(
              'text-xs',
              isColoured ? 'text-white/80' : 'text-(--color-text-dim)',
              today && 'text-(--color-text) border border-(--color-text) rounded-sm size-5 flex items-center justify-center',
            )}
          >
            {format(d, 'd')}
          </span>
        </div>
        {cell ? (
          <div className="space-y-0.5">
            <div className="text-base font-mono text-white">
              {formatUsd(cell.pnl)}
            </div>
            <div className="text-xs text-white/70">
              {cell.count} trade{cell.count === 1 ? '' : 's'}
            </div>
            {winRate !== null ? (
              <div className="text-xs font-mono tabular-nums text-white/45">
                {winRate}%
              </div>
            ) : null}
          </div>
        ) : null}
      </Link>
    )
  }
}

function WeekCard({
  index,
  pnl,
  tradedDays,
}: {
  index: number
  pnl: number
  tradedDays: number
}) {
  const tone: 'win' | 'loss' | 'dim' =
    pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'dim'
  return (
    <div className="rounded-(--radius) border border-(--color-cal-week-border) bg-transparent p-3.5 min-h-[88px] sm:min-h-[104px] flex flex-col justify-center gap-0.5">
      <div className="text-xs tracking-wider text-(--color-text-dim)">
        Week {index}
      </div>
      <div
        className={cn(
          'font-mono text-lg tabular-nums',
          tone === 'win' && 'text-(--color-win)',
          tone === 'loss' && 'text-(--color-loss)',
          tone === 'dim' && 'text-(--color-text-dim)',
        )}
      >
        {formatUsd(pnl)}
      </div>
      <div>
        <span className="inline-flex h-5 items-center justify-center rounded-full bg-(--color-accent-deep) text-(--color-accent-fg) text-xs leading-none px-2.5 pb-px">
          {tradedDays} day{tradedDays === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  )
}
