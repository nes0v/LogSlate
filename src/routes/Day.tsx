import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { db } from '@/db/schema'
import type { Model } from '@/db/types'
import { getDayNote, listDayScreenshotsFor, listModels } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { firstExecutionMs } from '@/lib/trade-math'
import { aggregate } from '@/lib/trade-stats'
import { useArrowNavigation } from '@/lib/use-arrow-navigation'
import { DayNewsSection } from '@/components/DayNewsSection'
import { DayNoteSection } from '@/components/DayNoteSection'
import { DayScreenshotSection } from '@/components/DayScreenshotSection'
import { PageHeader } from '@/components/PageHeader'
import { StatsGrid } from '@/components/StatsGrid'
import { TradeTable } from '@/components/TradeTable'
import { BTN_ACCENT } from '@/components/form/buttonClass'

export function DayRoute() {
  const { date = '' } = useParams()
  const navigate = useNavigate()
  const parsed = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISO(date) : null
  const pretty = parsed ? format(parsed, 'EEEE, MMMM d, yyyy') : date

  const accountId = useActiveAccountId()
  // All four day-scoped queries live here so the page can reveal as a
  // single unit. Children are pure presentational: news, note, and
  // screenshot data are passed in as props instead of each component
  // opening its own `useLiveQuery` (which would each settle on a separate
  // microtask, producing the multi-stage flicker).
  const trades = useLiveQuery(
    async () => {
      const rows = await db.trades
        .where('[account_id+date]')
        .equals([accountId, date])
        .toArray()
      const sortKey = (t: typeof rows[number]) =>
        firstExecutionMs(t) ?? Date.parse(t.created_at)
      return rows.sort((a, b) => sortKey(a) - sortKey(b))
    },
    [date, accountId],
  )
  const news = useLiveQuery(
    async () => {
      const rows = await db.news.where('date').equals(date).toArray()
      // ISO 8601 strings sort lexicographically — no Date.parse needed.
      rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      return rows
    },
    [date],
  )
  const note = useLiveQuery(
    () => getDayNote(accountId, date),
    [accountId, date],
  )
  const screenshots = useLiveQuery(
    () => listDayScreenshotsFor(accountId, date),
    [accountId, date],
  )
  // Models are resolved once at the route level so trade rows render with
  // the right name on first paint instead of flashing "gambling" → real.
  const models = useLiveQuery(
    () => listModels(accountId),
    [accountId],
  )
  const modelById = useMemo(() => {
    const m = new Map<string, Model>()
    for (const p of models ?? []) m.set(p.id, p)
    return m
  }, [models])
  // Page renders as soon as Dexie queries settle — screenshots resolve
  // their own blob URLs in `<ScreenshotThumb>` so the page doesn't wait
  // on image fetches. Each thumb shows its own loading placeholder
  // until its blob URL is ready.
  const loaded =
    trades !== undefined &&
    news !== undefined &&
    note !== undefined &&
    screenshots !== undefined &&
    models !== undefined

  // Every distinct day that has trades for this account — used to skip empty
  // days in prev/next navigation. `uniqueKeys()` walks the compound index
  // without pulling trade rows into memory, so this stays cheap even with
  // hundreds of trades.
  const tradingDays = useLiveQuery(
    async () => {
      const keys = await db.trades
        .where('[account_id+date]')
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
  // Stable identity so the memoized `<TradeTable>` doesn't re-render on
  // every parent render.
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="pt-1 space-y-8">
      <PageHeader
        back
        title={pretty}
        prev={prevDate ? `/day/${prevDate}` : null}
        next={nextDate ? `/day/${nextDate}` : null}
        prevLabel="Previous day with trades"
        nextLabel="Next day with trades"
        rightSlot={
          <Link to={`/trade/new?date=${date}`} className={BTN_ACCENT}>
            <Plus className="size-4" /> New trade
          </Link>
        }
      />

      {/* Everything below the header is gated on ALL day-scoped queries so
          the page renders as a single unit. Children receive their data
          as props — no per-section live queries that would each settle
          asynchronously and produce a multi-stage flicker. */}
      {loaded ? (
        <>
          <StatsGrid stats={stats} />

          <DayNewsSection events={news} />

          <DayNoteSection accountId={accountId} date={date} stored={note} />

          <DayScreenshotSection
            accountId={accountId}
            date={date}
            screenshots={screenshots}
          />

          <section className="space-y-2">
            <h2 className="text-sm font-medium">
              Trades{' '}
              <span className="text-(--color-text-dim) font-normal">
                ({trades.length})
              </span>{' '}
              <span className="text-(--color-win) font-normal">{stats.wins}W</span>{' '}
              <span className="text-(--color-loss) font-normal">{stats.losses}L</span>
            </h2>
            {trades.length > 0 ? (
              <TradeTable
                trades={trades}
                expandedIds={expandedIds}
                onToggle={toggleExpanded}
                modelById={modelById}
              />
            ) : (
              <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
                No trades on this day yet.
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
