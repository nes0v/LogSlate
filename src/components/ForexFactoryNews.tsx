import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import {
  eventsOnDay,
  fetchForexFactoryWeek,
  type FFEvent,
  type FFImpact,
  type FFWeek,
} from '@/lib/forex-factory'
import { NY_TZ, nyDateKey, nyTimeHHmm } from '@/lib/tz'
import { cn } from '@/lib/utils'

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

// ForexFactory-style impact dots. Red = high, orange = medium, yellow = low,
// gray = non-economic/holiday.
const IMPACT_FILL: Record<FFImpact, string> = {
  High: '#ef4444', // red
  Medium: '#f59e0b', // amber
  Low: '#6b7280', // gray
  Holiday: '#6b7280', // gray
}

function ImpactDot({ impact }: { impact: FFImpact }) {
  return (
    <svg
      viewBox="0 0 10 10"
      className="size-3"
      aria-label={`${impact} impact`}
      role="img"
    >
      <circle cx="5" cy="5" r="4.5" fill={IMPACT_FILL[impact]} />
    </svg>
  )
}

export function ForexFactoryNews() {
  const [loadedByWeek, setLoadedByWeek] = useState<Partial<Record<FFWeek, FFEvent[]>>>({})
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [userCurrency, setUserCurrency] = useState<string | null>(null)
  const [dayKey, setDayKey] = useState<string>(() => nyDateKey(new Date()))
  // Ticks every minute so past-vs-upcoming styling stays correct without a
  // render-phase Date.now() (forbidden by react-hooks/purity).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const inflightRef = useRef<Set<FFWeek>>(new Set())
  // Tracks which weeks we've already tried so a 404 on a neighbor week doesn't
  // get retried every time the user paginates past the currently-loaded range.
  const attemptedRef = useRef<Partial<Record<FFWeek, 'ok' | 'fail'>>>({})

  const loadWeek = useCallback((week: FFWeek, force = false) => {
    if (inflightRef.current.has(week)) return
    if (!force && attemptedRef.current[week]) return
    inflightRef.current.add(week)
    fetchForexFactoryWeek(week, force)
      .then(data => {
        attemptedRef.current[week] = 'ok'
        setLoadedByWeek(prev => ({ ...prev, [week]: data }))
        if (week === 'thisweek') setError(null)
      })
      .catch(err => {
        attemptedRef.current[week] = 'fail'
        // Only surface the primary feed's failure. A 404 on next/last week
        // just means that window isn't available — leave the UI to show
        // "No events." when the user pages there.
        if (week === 'thisweek') setError((err as Error).message ?? String(err))
      })
      .finally(() => inflightRef.current.delete(week))
  }, [])

  // Always load this week on mount.
  useEffect(() => {
    loadWeek('thisweek')
  }, [loadWeek])

  const events = useMemo(() => {
    const arr: FFEvent[] = []
    for (const v of Object.values(loadedByWeek)) if (v) arr.push(...v)
    return arr
  }, [loadedByWeek])

  // Lazy-load the neighboring week when the user pages outside the currently
  // loaded range. No-op once the week is fetched (or in flight).
  useEffect(() => {
    if (events.length === 0) return
    const dates = events.map(e => nyDateKey(new Date(e.date))).sort()
    const min = dates[0]
    const max = dates[dates.length - 1]
    if (dayKey < min && !loadedByWeek.lastweek) loadWeek('lastweek')
    if (dayKey > max && !loadedByWeek.nextweek) loadWeek('nextweek')
  }, [dayKey, events, loadedByWeek.lastweek, loadedByWeek.nextweek, loadWeek])

  async function refresh() {
    setRefreshing(true)
    try {
      // Refresh only the weeks we've already loaded.
      const weeks = Object.keys(loadedByWeek) as FFWeek[]
      await Promise.all(weeks.map(w => fetchForexFactoryWeek(w, true).then(
        data => setLoadedByWeek(prev => ({ ...prev, [w]: data })),
      )))
      setError(null)
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const loading = events.length === 0 && error === null

  // `nowMs` ticks every minute — derive today's NY key from it so a midnight
  // rollover refreshes the Today button state without a Date() call in render.
  const todayKey = useMemo(() => nyDateKey(new Date(nowMs)), [nowMs])
  const allDay = useMemo(
    () =>
      eventsOnDay(events, dayKey).sort(
        (a, b) => Date.parse(a.date) - Date.parse(b.date),
      ),
    [events, dayKey],
  )

  const currencies = useMemo(() => {
    // USD pill is always shown even if the day has no USD events.
    const set = new Set<string>(['USD'])
    for (const e of allDay) if (e.country) set.add(e.country)
    return Array.from(set).sort()
  }, [allDay])

  // Default filter is always USD. User choice (if any) wins.
  const currency = userCurrency ?? 'USD'
  const setCurrency = (v: string) => setUserCurrency(v)

  const dayEvents = useMemo(
    () => (currency === 'all' ? allDay : allDay.filter(e => e.country === currency)),
    [allDay, currency],
  )

  const isToday = dayKey === todayKey

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-medium mr-1">News</h2>
          <button
            type="button"
            onClick={() => setDayKey(shiftDayKey(dayKey, -1))}
            aria-label="Previous day"
            className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm text-(--color-text-dim) font-mono min-w-28 text-center">
            {prettyDayLabel(dayKey)} NY
          </span>
          <button
            type="button"
            onClick={() => setDayKey(shiftDayKey(dayKey, 1))}
            aria-label="Next day"
            className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          >
            <ChevronRight className="size-4" />
          </button>
          {!isToday && (
            <button
              type="button"
              onClick={() => setDayKey(todayKey)}
              className="ml-1 px-2 py-1 text-xs rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1 text-xs font-mono mr-2">
            <CurrencyPill active={currency === 'all'} onClick={() => setCurrency('all')}>
              All
            </CurrencyPill>
            {currencies.map(c => (
              <CurrencyPill
                key={c}
                active={currency === c}
                onClick={() => setCurrency(c)}
              >
                {c}
              </CurrencyPill>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Refresh"
            className="p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3.5', (refreshing || loading) && 'animate-spin')} />
          </button>
        </div>
      </div>
      <div className="bg-(--color-panel) border border-(--color-border) rounded-md">
        {error ? (
          <div className="p-3 text-xs text-(--color-loss)">Failed to load news: {error}</div>
        ) : loading ? (
          <div className="p-3 text-xs text-(--color-text-dim)">Loading…</div>
        ) : dayEvents.length === 0 ? (
          <div className="p-3 text-xs text-(--color-text-dim)">No events.</div>
        ) : (
          <div className="divide-y divide-(--color-border)">
            {dayEvents.map(e => (
              <EventRow key={`${e.date}|${e.country}|${e.title}`} event={e} nowMs={nowMs} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function CurrencyPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded-md border transition-colors',
        active
          ? 'border-(--color-border) bg-(--color-panel-2) text-(--color-text)'
          : 'border-transparent text-(--color-text-dim) hover:text-(--color-text)',
      )}
    >
      {children}
    </button>
  )
}

function EventRow({ event, nowMs }: { event: FFEvent; nowMs: number }) {
  const d = new Date(event.date)
  const time = Number.isNaN(d.getTime()) ? '—' : nyTimeHHmm(d)
  const isPast = !Number.isNaN(d.getTime()) && d.getTime() < nowMs
  return (
    <div className="grid grid-cols-[3.5rem_auto_auto_1fr] gap-3 items-center px-3 py-2 text-xs">
      <span
        className={cn(
          'font-mono tabular-nums',
          isPast ? 'text-gray-700' : 'text-(--color-text-dim)',
        )}
      >
        {time}
      </span>
      <span className="font-mono text-(--color-text-dim) uppercase w-10">{event.country || '—'}</span>
      <ImpactDot impact={event.impact} />
      <span className="truncate" title={event.title}>
        {event.title}
      </span>
    </div>
  )
}

