import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import {
  eventsByDay,
  readNews,
  refreshNews,
  weekCovers,
  type FFEvent,
  type NewsSnapshot,
} from '@/lib/forex-factory'
import { ImpactDot } from '@/components/ImpactDot'
import { readArchivedWeek, syncWeekNews, type ArchivedWeek } from '@/lib/news-sync'
import { lastReachableDay, newsDayMode } from '@/lib/news-day'
import { NY_TZ, nyDateKey, nyTimeHHmm, weekStartKey } from '@/lib/tz'
import { cn, errorMessage } from '@/lib/utils'

const nyDayHeader = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

/** Add N days to a YYYY-MM-DD key, returning YYYY-MM-DD. */
function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + delta))
  const yy = next.getUTCFullYear()
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(next.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function prettyDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  // Render via Intl so the label matches NY style ("Mon Apr 21").
  const probe = new Date(Date.UTC(y, m - 1, d, 12)) // noon UTC is safely inside NY calendar day
  return nyDayHeader.format(probe)
}

export function ForexFactoryNews() {
  // Paint from the cached week synchronously, then refresh in the
  // background. localStorage reads without awaiting, which is the whole
  // reason the current week lives there: the panel has rows in its first
  // frame instead of resolving into them.
  const [snapshot, setSnapshot] = useState<NewsSnapshot>(readNews)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Whether this panel's own load has come back, win or lose.
  const [settled, setSettled] = useState(false)
  // Blocks rapid re-clicks that would trip the feed's rate limit.
  const [coolingDown, setCoolingDown] = useState(false)
  const [userCurrency, setUserCurrency] = useState<string | null>(null)
  const [dayKey, setDayKey] = useState<string>(() => nyDateKey(new Date()))
  // Ticks every minute so past-vs-upcoming styling stays correct without a
  // render-phase Date.now() (forbidden by react-hooks/purity).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Written as a promise chain rather than async/await so no setState is
  // reachable synchronously from the effect below.
  const load = useCallback(
    (force: boolean) =>
      refreshNews(force)
        .then(({ snapshot: next, fetched }) => {
          setSnapshot(next)
          setError(null)
          if (fetched) void syncWeekNews(fetched)
        })
        .catch((e: unknown) => setError(errorMessage(e)))
        // Settled, however it went. The spinner asks "has my request come
        // back", which is not the same question as "did it bring anything":
        // a call inside the failure backoff returns an empty snapshot and no
        // error at all, and keying the spinner off the error left the panel
        // spinning for as long as the app stayed open.
        .finally(() => setSettled(true)),
    [],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  async function refresh() {
    if (refreshing || coolingDown) return
    setRefreshing(true)
    setCoolingDown(true)
    setTimeout(() => setCoolingDown(false), 8000)
    try {
      await load(true)
    } finally {
      setRefreshing(false)
    }
  }

  const hasData = snapshot.events.length > 0

  // `nowMs` ticks every minute — derive today's NY key from it so a midnight
  // rollover refreshes the Today button state without a Date() call in render.
  const todayKey = useMemo(() => nyDateKey(new Date(nowMs)), [nowMs])

  // Two sources, split on the week. The cached week is the whole calendar —
  // every currency, every impact. Every other week comes from the IndexedDB
  // archive, which keeps USD high/medium only; the lone pill in the header
  // says as much on those days.
  const covered = weekCovers(snapshot, dayKey)
  const week = weekStartKey(dayKey)

  // Which of three kinds of day this is — see `news-day.ts` for why these
  // rules live outside the component. Note it is measured against the feed's
  // week, not the cache's: a failed first fetch must not take the Refresh
  // button away at the one moment it is needed.
  const mode = newsDayMode(dayKey, todayKey)
  const currentWeekDay = mode === 'current'
  const archiveDay = mode === 'archive'
  const unpublishedDay = mode === 'unpublished'

  // Archive weeks already read, keyed by their Sunday. Held in state (not a
  // ref) so an arriving week repaints, and never evicted — a week is a
  // handful of rows and the panel is paged by hand.
  const [archive, setArchive] = useState<Record<string, ArchivedWeek>>({})
  // Weeks already asked for, so a re-render cannot ask twice. A ref, not
  // state: putting it in state would feed back into the effect below, and an
  // effect that re-runs whenever its own result lands cancels the sibling
  // reads still in flight and has to start them over — the warming would
  // then arrive late, which is the whole thing it exists to prevent.
  const requested = useRef<Set<string>>(new Set())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    // Warm this day's week and both neighbours. Paging is one arrow click at
    // a time, so the week on either side is where the user is about to be —
    // loading it now is what keeps the crossing from painting a "Loading…"
    // frame. Runs on the cached week too, so stepping off it backwards is
    // warm on the very first click.
    const wanted = [
      weekStartKey(shiftDayKey(week, -1)),
      week,
      weekStartKey(shiftDayKey(week, 7)),
    ]
    for (const w of wanted) {
      // The feed cache already answers its own week in full; the archive
      // would only return a thinner copy of it.
      if (w === snapshot.week) continue
      if (requested.current.has(w)) continue
      requested.current.add(w)
      void readArchivedWeek(w).then(days => {
        if (mounted.current) setArchive(prev => ({ ...prev, [w]: days }))
      })
    }
  }, [week, snapshot.week])

  // Bucketed once per snapshot, so an arrow click is a lookup.
  const cachedByDay = useMemo(() => eventsByDay(snapshot), [snapshot])
  const allDay = useMemo(() => {
    if (covered) return cachedByDay[dayKey] ?? []
    return archive[week]?.[dayKey] ?? []
  }, [covered, cachedByDay, dayKey, archive, week])
  // Until this day's week has been read, hold the spinner rather than
  // flashing "No events." at a day that is about to fill in.
  const archivePending = !covered && archive[week] === undefined
  // On an archive day the feed request has no bearing on what is shown: the
  // archive has already answered, and answering "nothing" is an answer. Only
  // a day the feed is responsible for waits on the feed.
  const loading = archiveDay
    ? archivePending
    : archivePending || (!settled && !hasData && allDay.length === 0 && error === null)

  // Default filter is always USD. User choice (if any) wins.
  const currency = userCurrency ?? 'USD'
  const setCurrency = (v: string) => setUserCurrency(v)

  const currencies = useMemo(() => {
    // USD is always offered even on a day holding no USD events, and so is
    // whatever is currently selected: step from a busy Thursday onto a quiet
    // Saturday and the filter still applies, so it has to stay visible.
    // Without it the row renders with nothing active and no way to see, or
    // clear, what is hiding the day.
    const set = new Set<string>(['USD'])
    if (currency !== 'all') set.add(currency)
    for (const e of allDay) if (e.country) set.add(e.country)
    return Array.from(set).sort()
  }, [allDay, currency])

  const dayEvents = useMemo(() => {
    // Off the cached week there is nothing to filter — showing everything
    // the archive has is the point. A currency picked while on the cached
    // week must not follow the user back and blank the day.
    if (!covered) return allDay
    return currency === 'all' ? allDay : allDay.filter(e => e.country === currency)
  }, [covered, allDay, currency])

  // A day can hold events and still show nothing, because the filter starts
  // on USD and plenty of days carry no USD release at all. Saying "No
  // events." there states something untrue about the day, so name what is
  // being filtered out instead.
  const emptyMessage = useMemo(() => {
    if (unpublishedDay) return 'Not published yet.'
    // `fetchedAt` is 0 only if no fetch has ever succeeded. Reaching here
    // with that means the request came back empty-handed and quietly — the
    // backoff swallows the reason — so say so rather than reporting the week
    // as a week with no news in it.
    if (currentWeekDay && snapshot.fetchedAt === 0) return 'Could not load the news feed.'
    // "No events." on a day holding four of them, none of them USD, states
    // something untrue about the day. Naming the filter is enough.
    if (allDay.length > dayEvents.length) return `No ${currency} events.`
    return 'No events.'
  }, [unpublishedDay, currentWeekDay, snapshot.fetchedAt, allDay, dayEvents, currency])

  const isToday = dayKey === todayKey
  // Forward stop, the same idea as the Progress page's clamp: the feed
  // publishes no future week, so past this point every day is empty by
  // construction.
  const atLastDay = dayKey >= lastReachableDay(todayKey)

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-medium mr-1">News</h2>
          <button
            type="button"
            onClick={() => setDayKey(shiftDayKey(dayKey, -1))}
            aria-label="Previous day"
            className="p-1 rounded-(--radius) text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm text-(--color-text-dim) font-mono min-w-28 text-center">
            {prettyDayLabel(dayKey)} NY
          </span>
          <button
            type="button"
            onClick={() => setDayKey(shiftDayKey(dayKey, 1))}
            disabled={atLastDay}
            aria-label="Next day"
            className="p-1 rounded-(--radius) text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-(--color-text-dim)"
          >
            <ChevronRight className="size-4" />
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={() => setDayKey(todayKey)}
              className="ml-1 px-2 py-1 text-xs rounded-(--radius) border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Off the cached week the archive holds one currency and two
              impacts, so a filter would be a control with nothing to choose
              between. The lone pill states the breadth instead — it is the
              caption, not a filter. */}
          <div className="flex items-center gap-1 text-xs font-mono mr-2">
            {currentWeekDay && (
              <>
                <CurrencyPill active={currency === 'all'} onClick={() => setCurrency('all')}>
                  All
                </CurrencyPill>
                {currencies.map(c => (
                  <CurrencyPill
                    key={c}
                    active={currency === c}
                    onClick={() => setCurrency(c)}
                    // The feed files global events under the currency "All",
                    // which would otherwise read as a second copy of the
                    // filter pill beside it. Uppercase tells them apart and
                    // matches the table's currency column.
                    uppercase
                  >
                    {c}
                  </CurrencyPill>
                ))}
              </>
            )}
            {archiveDay && <CurrencyPill active>USD high/medium</CurrencyPill>}
          </div>
          {/* Refresh pulls the week the feed is serving, so it can only ever
              change what a day inside that week shows. Behind it sits the
              archive, which no fetch reaches; ahead of it sits a day nothing
              has been published for, and refreshing cannot make the feed roll
              early. */}
          {currentWeekDay && (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing || coolingDown}
              aria-label="Refresh"
              className="p-1.5 rounded-(--radius) text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3.5', (refreshing || loading) && 'animate-spin')} />
            </button>
          )}
        </div>
      </div>
      {error && hasData && (
        <div className="text-xs text-(--color-loss)">{error}</div>
      )}
      <div className="bg-(--color-panel) rounded-(--radius) overflow-hidden">
        {error && !archiveDay && !hasData && allDay.length === 0 ? (
          <div className="p-3 text-xs text-(--color-loss)">Failed to load news: {error}</div>
        ) : loading ? (
          <div className="p-3 text-xs text-(--color-text-dim)">Loading…</div>
        ) : dayEvents.length === 0 ? (
          <div className="p-3 text-xs text-(--color-text-dim)">{emptyMessage}</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {dayEvents.map(e => (
                <EventRow
                  key={`${e.date}|${e.country}|${e.title}`}
                  event={e}
                  nowMs={nowMs}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

function CurrencyPill({
  active,
  onClick,
  uppercase,
  children,
}: {
  active: boolean
  /** Omitted when the pill is a caption rather than a filter. */
  onClick?: () => void
  uppercase?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={onClick === undefined}
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded-(--radius) border',
        uppercase && 'uppercase',
        active
          ? 'border-(--color-border) bg-(--color-panel-2) text-(--color-text)'
          : 'border-transparent text-(--color-text-dim) hover:text-(--color-text)',
      )}
    >
      {children}
    </button>
  )
}

function EventRow({
  event,
  nowMs,
}: {
  event: FFEvent
  nowMs: number
}) {
  const d = new Date(event.date)
  const time = Number.isNaN(d.getTime()) ? '—' : nyTimeHHmm(d)
  const isPast = !Number.isNaN(d.getTime()) && d.getTime() < nowMs
  return (
    <tr className="border-t border-(--color-bg) [&>td]:pt-[7px] [&>td]:pb-[9px] [&>td]:align-middle">
      <td
        className={cn(
          'pl-3 pr-6 text-xs font-mono tabular-nums w-px whitespace-nowrap',
          isPast ? 'text-(--color-text-faint)' : 'text-(--color-text-dim)',
        )}
      >
        {time}
      </td>
      <td className="pl-0 pr-6 text-xs font-mono text-(--color-text-dim) uppercase w-px whitespace-nowrap">
        {event.country || '—'}
      </td>
      <td className="pl-0 pr-3 w-px">
        <ImpactDot impact={event.impact} />
      </td>
      <td className="pl-0 pr-3 text-xs truncate" title={event.title}>
        {event.title}
      </td>
    </tr>
  )
}

