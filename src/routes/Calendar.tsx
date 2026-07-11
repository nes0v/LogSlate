import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addDays,
  addMonths,
  format,
  isSameMonth,
  isWeekend,
  subMonths,
} from 'date-fns'
import { monthDayGrid } from '@/lib/calendar-grid'
import { Image as ImageIcon, StickyNote, type LucideIcon } from 'lucide-react'
import { dateKeyToDate, nyDateKey } from '@/lib/tz'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import { classifyTrade, computeNetPnl } from '@/lib/trade-math'
import { classifyDayPnl } from '@/lib/advanced-stats'
import { netPnlByDate } from '@/lib/day-pnl'
import { signedAdjustment } from '@/lib/trade-stats'
import { useStartingEquity } from '@/lib/use-starting-equity'
import { formatUsd } from '@/lib/money'
import { parseYearMonth } from '@/lib/buckets'
import { ForexFactoryNews } from '@/components/ForexFactoryNews'
import { PageHeader } from '@/components/PageHeader'
import { MonthPicker } from '@/components/form/MonthPicker'
import { cn } from '@/lib/utils'

const DATE_KEY = 'yyyy-MM-dd'

// Shared PNL → text-tone mapping. Used by the month-net header tile and
// the WeekCard total so the sign-based color stays consistent.
function pnlToneClass(amount: number): string {
  if (amount > 0) return 'text-(--color-win)'
  if (amount < 0) return 'text-(--color-loss)'
  return 'text-(--color-text-dim)'
}

export function CalendarRoute() {
  const { ym } = useParams()
  const navigate = useNavigate()

  // Memoize date derivations so `useMemo` deps compare by stable reference.
  const { month, gridStart, gridEnd, days } = useMemo(() => {
    const month = parseYearMonth(ym)
    const { start: gridStart, end: gridEnd, days } = monthDayGrid(month)
    return { month, gridStart, gridEnd, days }
  }, [ym])

  const rangeStart = format(gridStart, DATE_KEY)
  const rangeEnd = format(gridEnd, DATE_KEY)
  const accountId = useActiveAccountId()

  // No defaults — `loaded` gates the day grid so colored cells don't flash
  // a gray "no trades" state before Dexie resolves.
  const trades = useLiveQuery(
    () =>
      db.trades
        .where('[account_id+date]')
        .between([accountId, rangeStart], [accountId, rangeEnd], true, true)
        .toArray(),
    [rangeStart, rangeEnd, accountId],
  )
  const dayRows = useLiveQuery(
    () =>
      db.days
        .where('[account_id+date]')
        .between([accountId, rangeStart], [accountId, rangeEnd], true, true)
        .toArray(),
    [rangeStart, rangeEnd, accountId],
  )
  // Adjustments inside the grid range — needed so per-day equity walks
  // pick up mid-month deposits / withdrawals when applying the ±0.4%
  // scratch band.
  const rangeAdjustments = useLiveQuery(
    () =>
      db.adjustments
        .where('[account_id+date]')
        .between([accountId, rangeStart], [accountId, rangeEnd], true, true)
        .toArray(),
    [rangeStart, rangeEnd, accountId],
    [],
  )
  // Real account equity at the moment the grid starts. Walking forward
  // day-by-day from this baseline gives each cell its own start-of-day
  // equity for the scratch check.
  const gridStartEquity = useStartingEquity(rangeStart)
  // Gate the month grid on equity too — otherwise the first paint
  // classifies near-threshold days with `band = $8` (equity defaults
  // to 0 while loading) and re-renders to the real ±0.4%/$8 band a
  // moment later, briefly flashing the wrong cell tone.
  const loaded =
    trades !== undefined && dayRows !== undefined && gridStartEquity !== undefined

  const screenshotDays = useMemo(() => {
    const s = new Set<string>()
    for (const d of dayRows ?? []) {
      if (d.screenshots.length > 0) s.add(d.date)
    }
    return s
  }, [dayRows])

  // Day-level note indicator — lights up when the user has written a
  // free-text journal entry on that day's record. The note is stored on
  // the Day row's `note` field, scoped to the active account.
  const noteDays = useMemo(() => {
    const s = new Set<string>()
    for (const d of dayRows ?? []) {
      if (d.note && d.note.trim().length > 0) s.add(d.date)
    }
    return s
  }, [dayRows])

  // Per-day map. Wins/losses are tracked separately from `count` so a
  // day that only contains scratches renders in the dim/scratch tone
  // instead of being miscoloured by fee/slippage residue in the PNL
  // sum. `wins` also feeds the per-day win-rate badge. `startEquity` is
  // the account equity right before that day's trades — used by the
  // ±0.4% scratch band so small-net days dim instead of going green/red.
  const perDay = useMemo(() => {
    const m = new Map<string, PerDayCell>()
    for (const t of trades ?? []) {
      const pnl = computeNetPnl(t) ?? 0
      const cur =
        m.get(t.date) ?? { pnl: 0, count: 0, wins: 0, losses: 0, startEquity: 0 }
      cur.pnl += pnl
      cur.count += 1
      const outcome = classifyTrade(t)
      if (outcome === 'win') cur.wins += 1
      else if (outcome === 'loss') cur.losses += 1
      m.set(t.date, cur)
    }
    // A day-level override replaces that day's trade PNL. Mark the cell so it
    // colours by its PNL even with no decided trades (a tilt day reads red,
    // not as a dim scratch).
    for (const d of dayRows ?? []) {
      if (typeof d.pnl_override !== 'number') continue
      const cur =
        m.get(d.date) ?? { pnl: 0, count: 0, wins: 0, losses: 0, startEquity: 0 }
      cur.pnl = d.pnl_override
      cur.isOverride = true
      m.set(d.date, cur)
    }
    const adjByDate = new Map<string, number>()
    for (const a of rangeAdjustments) {
      adjByDate.set(a.date, (adjByDate.get(a.date) ?? 0) + signedAdjustment(a))
    }
    // Walk the grid in date order, threading running equity through each
    // day so cells carry their own start-of-day baseline.
    let runningEquity = gridStartEquity ?? 0
    for (const d of days) {
      const key = format(d, DATE_KEY)
      const cell = m.get(key)
      if (cell) cell.startEquity = runningEquity
      runningEquity += (cell?.pnl ?? 0) + (adjByDate.get(key) ?? 0)
    }
    return m
  }, [trades, dayRows, rangeAdjustments, gridStartEquity, days])

  const monthNet = useMemo(() => {
    const overrides = new Map<string, number>()
    for (const d of dayRows ?? []) {
      if (typeof d.pnl_override === 'number') overrides.set(d.date, d.pnl_override)
    }
    let total = 0
    for (const [date, net] of netPnlByDate(trades ?? [], overrides)) {
      if (isSameMonth(dateKeyToDate(date), month)) total += net
    }
    return total
  }, [trades, dayRows, month])

  // Carry the weekend flag alongside the label so weekend styling
  // doesn't depend on the label *string* (which is locale-formatted by
  // `format(d, 'EEE')`).
  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(gridStart, i)
        return { label: format(d, 'EEE'), isWeekend: isWeekend(d) }
      }),
    [gridStart],
  )

  // Chunk the day grid into weekly rows + per-week PNL & traded-day count.
  // Each card's total covers the FULL Mon–Fri trading week, so when a month
  // starts or ends mid-week the card includes the adjacent-month days of
  // that week — matching the card's drill-down link (from=Mon … to=Fri).
  // The card label ("Week of …") names the week, not the month, so this is
  // a whole-week figure, not the month's contribution to that week. (The
  // header's monthNet is separately month-scoped via isSameMonth.)
  //
  // Skip weeks whose only in-month days are Sat/Sun (futures don't trade
  // weekends, so a row of pure padding plus a lone weekend reads as empty
  // noise — e.g. May 2026 where the 31st is a Sunday).
  const weeks = useMemo(() => {
    const out: Array<{ days: Date[]; pnl: number; tradedDays: number }> = []
    for (let i = 0; i < days.length; i += 7) {
      const slice = days.slice(i, i + 7)
      const hasInMonthWeekday = slice.some(
        d => isSameMonth(d, month) && !isWeekend(d),
      )
      if (!hasInMonthWeekday) continue
      let pnl = 0
      let tradedDays = 0
      for (const d of slice) {
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
    <div className="pt-1 space-y-8">
      <PageHeader
        title={
          <MonthPicker
            value={format(month, 'yyyy-MM')}
            onChange={v => v && navigate(`/month/${v}`)}
            renderTrigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="text-lg font-semibold rounded-(--radius) cursor-pointer hover:text-(--color-accent) transition-colors"
              >
                {format(month, 'MMMM yyyy')}
              </button>
            )}
          />
        }
        prev={`/month/${format(subMonths(month, 1), 'yyyy-MM')}`}
        next={`/month/${format(addMonths(month, 1), 'yyyy-MM')}`}
        prevLabel="Previous month"
        nextLabel="Next month"
        rightSlot={
          loaded ? (
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-(--color-text-dim)">Month net</span>
              <span className={cn('text-lg font-mono', pnlToneClass(monthNet))}>
                {formatUsd(monthNet)}
              </span>
            </div>
          ) : null
        }
      />

      {/* Everything below the header is gated on the primary data load —
          including the cached news feed — so the page reveals as a single
          unit instead of news flashing on top while the calendar grid is
          still resolving. */}
      {loaded ? (
        <div className="space-y-8">
          {/* Grid: 7 day columns + a 24px aisle + a slightly wider week-summary
              column. The two `aria-hidden` placeholders below the weekday
              labels fill the aisle and week-card slots so the header row
              keeps the same column template. */}
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_0.75rem_minmax(0,1.4fr)] gap-1.5">
            {weekdayLabels.map(({ label, isWeekend: weekend }) => (
              <div
                key={label}
                className={cn(
                  'rounded-full text-xs font-bold text-center py-2',
                  weekend
                    ? 'bg-(--color-cal-weekend-bg) text-(--color-text-faint)'
                    : 'bg-(--color-panel) text-(--color-text)',
                )}
              >
                {label}
              </div>
            ))}
            <div aria-hidden />
            <div aria-hidden />
            {weeks.flatMap((week, weekIdx) => [
              ...week.days.map(d => {
                const key = format(d, DATE_KEY)
                const inMonth = isSameMonth(d, month)
                return (
                  <DayCell
                    key={`${weekIdx}-${key}`}
                    date={d}
                    inMonth={inMonth}
                    cell={perDay.get(key)}
                    // "Today" = today in NY, since the app is
                    // NY-trading-only. Local `isToday()` would treat
                    // the user's local day as today, which is wrong
                    // for a non-NY-resident trader.
                    isToday={key === nyDateKey()}
                    hasScreenshot={inMonth && screenshotDays.has(key)}
                    hasNote={inMonth && noteDays.has(key)}
                  />
                )
              }),
              <div key={`aisle-${weekIdx}`} aria-hidden />,
              <WeekCard
                key={`week-${weekIdx}`}
                anchor={week.days[WEEK_LABEL_DAY_INDEX]}
                rangeStart={week.days[WEEK_LABEL_DAY_INDEX]}
                rangeEnd={week.days[WEEK_LABEL_DAY_INDEX + 4]}
                pnl={week.pnl}
                tradedDays={week.tradedDays}
              />,
            ])}
          </div>

          <ForexFactoryNews />
        </div>
      ) : null}
    </div>
  )
}

// Per-day aggregate stored in the `perDay` map. `count` is total trades
// on the day; `wins` / `losses` exclude scratches (so the win-rate badge
// doesn't dilute on fee/slippage residue); `pnl` is the net PNL sum.
interface PerDayCell {
  pnl: number
  count: number
  wins: number
  losses: number
  startEquity: number
  // Set when the day's PNL comes from a manual `Day.pnl_override` rather than
  // its trades — used so the tone classifies by PNL even with no decided trades.
  isOverride?: boolean
}

// Shared sizing for both day cells and week summary cards so the row
// height stays uniform across the grid.
const CELL_HEIGHT_CLASS = 'h-[80px] sm:h-[100px]'

// Index into a week's `days` array used as the week-card label anchor.
// The calendar grid stays Sunday-first (see `monthDayGrid`) so position
// 1 is Monday — the conventional "week of" anchor for trading weeks.
const WEEK_LABEL_DAY_INDEX = 1

interface DayCellProps {
  date: Date
  inMonth: boolean
  cell: PerDayCell | undefined
  isToday: boolean
  hasScreenshot: boolean
  hasNote: boolean
}

function DayCell({ date, inMonth, cell, isToday, hasScreenshot, hasNote }: DayCellProps) {
  // Futures don't trade Sat/Sun — render a flat, non-interactive
  // surface (no Link, no hover) so weekends read as "closed" cells.
  // Handled first so the rest of the function only deals with
  // tradable days.
  if (isWeekend(date)) return <WeekendCell date={date} />

  const decided = cell ? cell.wins + cell.losses : 0
  const variant = pickVariant(inMonth, cell, decided)
  const palette = CELL_PALETTE[variant]
  const winRate =
    cell && decided > 0 ? Math.round((cell.wins / decided) * 100) : null
  const dateKey = format(date, DATE_KEY)

  return (
    <Link
      to={`/day/${dateKey}`}
      className={cn(
        'rounded-(--radius) border transition-colors p-2 flex flex-col gap-1',
        CELL_HEIGHT_CLASS,
        palette.surface,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {hasScreenshot ? (
            <CellIcon Icon={ImageIcon} className={palette.icon} label="Has screenshot" />
          ) : null}
          {hasNote ? (
            <CellIcon Icon={StickyNote} className={palette.icon} label="Has notes" />
          ) : null}
        </div>
        <span
          className={cn(
            'text-xs size-[26px] inline-flex items-center justify-center leading-none rounded-full -mt-1.5 -mr-1.5',
            isToday ? palette.dateToday : palette.date,
          )}
        >
          {format(date, 'd')}
        </span>
      </div>
      {cell ? (
        <div>
          <div className={cn('text-base font-mono', palette.pnl)}>
            {formatUsd(cell.pnl)}
          </div>
          <div className={cn('text-xs', palette.meta)}>
            {cell.isOverride && cell.count === 0 ? (
              <span className="underline">override</span>
            ) : cell.isOverride ? (
              <>
                <span className="underline">override</span>
                {` + ${cell.count} trade${cell.count === 1 ? '' : 's'}`}
              </>
            ) : (
              `${cell.count} trade${cell.count === 1 ? '' : 's'}`
            )}
          </div>
          {winRate !== null ? (
            <div className={cn('text-xs font-mono tabular-nums mt-0.5', palette.winRate)}>
              {winRate}%
            </div>
          ) : null}
        </div>
      ) : null}
    </Link>
  )
}

function WeekendCell({ date }: { date: Date }) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-(--radius) bg-(--color-cal-weekend-bg) p-2 flex flex-col gap-1 text-(--color-text-faint)',
        CELL_HEIGHT_CLASS,
      )}
    >
      <div className="flex items-center justify-end">
        <span className="text-xs size-[26px] inline-flex items-center justify-center leading-none rounded-full -mt-1.5 -mr-1.5 text-(--color-text-faint)">
          {format(date, 'd')}
        </span>
      </div>
    </div>
  )
}

// Wrapper so both Image and StickyNote share identical sizing,
// stroke, and rendering attributes — one place to tune if the look
// drifts again.
function CellIcon({
  Icon,
  className,
  label,
}: {
  Icon: LucideIcon
  className: string
  label: string
}) {
  return (
    <Icon
      className={cn('size-5', className)}
      strokeWidth={1.5}
      shapeRendering="geometricPrecision"
      aria-label={label}
    />
  )
}

// Day-cell visual variants. Each variant rolls up every class the cell
// needs — surface (bg/border/hover), date number color (default + today
// override that also carries `font-bold`), and the three text tiers
// (PNL, trades-count, win-rate) + corner icon color. Tweak a tone here
// and every dependent class moves together; adding a new variant is one
// new row.
type CellVariant = 'win' | 'loss' | 'scratch' | 'empty' | 'pad'

interface CellPalette {
  surface: string
  date: string
  dateToday: string
  pnl: string
  meta: string
  winRate: string
  icon: string
}

const CELL_PALETTE: Record<CellVariant, CellPalette> = {
  win: {
    surface: 'bg-(--color-cal-win-bg) border-transparent hover:brightness-125',
    date: 'text-white',
    dateToday: 'text-white font-bold',
    pnl: 'text-(--color-win)',
    meta: 'text-white/70',
    winRate: 'text-white/45',
    icon: 'text-(--color-cal-win-icon)',
  },
  loss: {
    surface: 'bg-(--color-cal-loss-bg) border-transparent hover:brightness-125',
    date: 'text-white',
    dateToday: 'text-white font-bold',
    pnl: 'text-(--color-loss)',
    meta: 'text-white/70',
    winRate: 'text-white/45',
    icon: 'text-(--color-cal-loss-icon)',
  },
  // Scratches-only in-month days get a warm stone card so they read as
  // distinct from win/loss (dark pine/wine) and from no-trade days
  // (panel-3). Dark text + dark icons sit on the light surface.
  scratch: {
    surface: 'bg-(--color-cal-scratch-bg) border-transparent hover:brightness-125',
    date: 'text-stone-900',
    dateToday: 'text-black font-bold',
    pnl: 'text-black/85',
    meta: 'text-black/60',
    winRate: 'text-black/45',
    icon: 'text-(--color-cal-scratch-icon)',
  },
  // In-month, no trades — PNL/meta/winRate slots go unused because the
  // cell guard skips rendering them, but the entries stay defined so
  // the palette stays uniform.
  empty: {
    surface: 'bg-(--color-panel-3) border-transparent hover:brightness-125',
    date: 'text-(--color-text-dim)',
    dateToday: 'text-white font-bold',
    pnl: '',
    meta: '',
    winRate: '',
    icon: 'text-(--color-cal-empty-icon)',
  },
  // Out-of-month padding cells — transparent surface with a hairline
  // border. Icons / metadata never render here (hasScreenshot/hasNote
  // both gate on inMonth), so those slots are inert.
  pad: {
    surface:
      'bg-transparent border-(--color-cal-pad-border) hover:bg-(--color-panel)/40 text-(--color-text-faint)',
    date: 'text-(--color-text-dim)',
    dateToday: 'text-(--color-text-dim)',
    pnl: '',
    meta: '',
    winRate: '',
    icon: '',
  },
}

function pickVariant(
  inMonth: boolean,
  cell: PerDayCell | undefined,
  decided: number,
): CellVariant {
  if (!inMonth) return 'pad'
  if (!cell) return 'empty'
  // Override days carry a real PNL with no decided trades — colour them by
  // that figure instead of forcing the neutral scratch tone.
  if (decided === 0 && !cell.isOverride) return 'scratch'
  return classifyDayPnl(cell.pnl, cell.startEquity)
}

function WeekCard({
  anchor,
  rangeStart,
  rangeEnd,
  pnl,
  tradedDays,
}: {
  anchor: Date
  rangeStart: Date
  rangeEnd: Date
  pnl: number
  tradedDays: number
}) {
  if (tradedDays === 0) {
    return (
      <div
        aria-hidden
        className={cn(
          'rounded-[22px] border border-(--color-cal-pad-border) bg-transparent',
          CELL_HEIGHT_CLASS,
        )}
      />
    )
  }
  const from = format(rangeStart, DATE_KEY)
  const to = format(rangeEnd, DATE_KEY)
  return (
    <Link
      to={`/overview?from=${from}&to=${to}`}
      className={cn(
        'rounded-[22px] bg-(--color-panel) p-3.5 flex flex-col justify-center gap-0.5 transition-colors hover:brightness-125',
        CELL_HEIGHT_CLASS,
      )}
    >
      <div className="text-xs tracking-wider text-(--color-text-dim)">
        Week of {format(anchor, 'MMM do')}
      </div>
      <div className={cn('font-mono text-lg tabular-nums', pnlToneClass(pnl))}>
        {formatUsd(pnl)}
      </div>
      <div>
        <span className="inline-flex h-5 items-center justify-center rounded-full bg-(--color-panel-3) text-(--color-text) text-xs leading-none px-2.5 pb-px">
          {tradedDays} day{tradedDays === 1 ? '' : 's'}
        </span>
      </div>
    </Link>
  )
}
