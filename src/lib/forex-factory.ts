// Economic calendar data from ForexFactory's weekly JSON feed (served by
// Faire Economy).
//
// Two facts about that feed shape everything here:
//
//  1. Only `ff_calendar_thisweek.json` still exists. The `lastweek` and
//     `nextweek` files 404 in every format (json/xml/csv) as of 2026-08, so
//     there is nothing to fetch for a neighbouring week.
//  2. It rolls every Sunday: on Sunday 2026-08-30 it stopped serving
//     Aug 23-29 and began serving Aug 30 - Sep 4.
//
// Together those mean past weeks exist only if we keep them, and that splits
// the storage in two:
//
//  - THIS week is the only week that is re-fetchable, so it lives in a
//    localStorage cache that is simply replaced on each fetch. It holds every
//    event, every currency, every impact — that is what the Calendar panel
//    surfs. Losing it costs nothing; the feed will hand it back.
//  - EVERY OTHER week exists only in IndexedDB (`news-sync.ts`), which keeps
//    USD high/medium forever and syncs to Drive. That is the archive, and it
//    is the only reason history exists at all.
//
// So paging back past this week narrows to USD high/medium. That is a
// deliberate trade: the full calendar is a planning tool for the week ahead,
// while reviewing an old trade only ever asks which USD driver was near it.
// Keeping full breadth forever would cost ~1.1MB a year in a Drive file that
// re-uploads whole on every sync, against ~120KB for the archive as scoped.
//
// Next week stays empty until the feed rolls onto it; that data isn't
// published anywhere we can reach.
//
// The feed sends no CORS headers, so it goes through a proxy (see TRANSPORTS).

import { nyDateKey, nyToday, weekStartKey } from '@/lib/tz'

const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'

/** Hard floor on network access: while the stored copy is younger than this,
 *  nothing but the Refresh button reaches the wire — not even a week that has
 *  since ended (see `isStale`). */
const FRESH_MS = 15 * 60 * 1000
/** After a failure, wait this long before trying again. */
const RETRY_MS = 5 * 60 * 1000
const STORE_KEY = 'logslate:ff:week.v1'

// Pre-week store: a 120-day day-keyed archive that this cache replaces. Its
// contents are either in the current week's fetch or in IndexedDB, so it is
// dead weight (up to a few hundred KB of it). Delete on sight.
// MIGRATION-PATTERN: strip this once it has run on the device.
try {
  localStorage.removeItem('logslate:ff:days.v1')
} catch {
  // storage unavailable — nothing to clean
}

const PROXY_KEY = (import.meta.env.VITE_CORSPROXY_KEY ?? '').trim()

export const FF_IMPACTS = ['High', 'Medium', 'Low', 'Holiday'] as const
export type FFImpact = (typeof FF_IMPACTS)[number]

// ForexFactory-style impact dot fill. Single source of truth for every news
// visual — the Calendar panel and the Day page both read it. Raw hex rather
// than a `--color-*` token (unlike `OUTCOME_COLORS` / `RATING_COLORS`)
// because this is the feed's own semantic palette, not the app's: red is
// "high impact", not "loss". Low and Holiday deliberately share one gray.
export const IMPACT_COLORS: Record<FFImpact, string> = {
  High: '#ef4444', // red
  Medium: '#f59e0b', // amber
  Low: '#6b7280', // gray
  Holiday: '#6b7280', // gray
}

export interface FFEvent {
  title: string
  country: string // e.g. "USD", "EUR", "ALL"
  date: string // ISO 8601
  impact: FFImpact
  forecast: string
  previous: string
}

/** The one cached week, exactly as the feed served it. */
export interface NewsSnapshot {
  /** Sunday opening the cached week (YYYY-MM-DD); '' when nothing is held. */
  week: string
  /** Every event in that week, unfiltered. */
  events: FFEvent[]
  /** Epoch ms of the last successful fetch; 0 if we've never had one. */
  fetchedAt: number
}

export interface RefreshResult {
  snapshot: NewsSnapshot
  /** The week just pulled, or null when the stored copy was still fresh. */
  fetched: FFEvent[] | null
}

interface Store extends NewsSnapshot {
  /** Epoch ms of the last failure, for backoff; 0 if none. */
  failedAt: number
}

/** A fresh empty store. A function, not a shared constant: callers receive
 *  these and a shared `events` array would be one stray mutation from
 *  leaking between them. */
function emptyStore(): Store {
  return { week: '', events: [], fetchedAt: 0, failedAt: 0 }
}

// ---------------------------------------------------------------- transports

interface Transport {
  label: string
  url: (feed: string) => string
  headers?: Record<string, string>
  /** Pulls the feed's own JSON text out of whatever the proxy wrapped it in. */
  unwrap: (body: string) => string
}

// Tried in order. corsproxy leads: it's keyed and fast, but it enforces
// registered origins (register dev AND prod at console.corsproxy.io) and it
// shares one egress IP across all its users that Faire Economy throttles, so
// a 429 here says nothing about our own usage. r.jina.ai backs it up — its
// own egress, works from any origin, no key.
const TRANSPORTS: Transport[] = [
  {
    label: 'news proxy',
    url: feed => {
      const key = PROXY_KEY ? `key=${encodeURIComponent(PROXY_KEY)}&` : ''
      return `https://corsproxy.io/?${key}url=${encodeURIComponent(feed)}`
    },
    unwrap: body => body,
  },
  {
    // Wraps the payload as {data: {content: "<the feed JSON, as a string>"}}.
    label: 'reader',
    url: feed => `https://r.jina.ai/${feed}`,
    headers: { Accept: 'application/json' },
    unwrap: body => {
      const wrapper = JSON.parse(body) as { data?: { content?: unknown } }
      const content = wrapper.data?.content
      if (typeof content !== 'string') throw new Error('unexpected shape')
      return content
    },
  },
]

// The feed also sends values we have no dot for ("Non-Economic" on holiday
// rows, and whatever it adds next). They land on Low, which renders the same
// gray as Holiday — the honest reading of "we know this is on the calendar
// and that it isn't a market driver".
function normalizeImpact(s: unknown): FFImpact {
  const v = String(s ?? '').trim()
  return (FF_IMPACTS as readonly string[]).includes(v) ? (v as FFImpact) : 'Low'
}

async function fetchVia(t: Transport, force: boolean): Promise<FFEvent[]> {
  // On a manual refresh, bypass the browser HTTP cache too — the proxies
  // return cacheable responses, so a default fetch would be served from
  // memory/disk cache and never hit the wire.
  const resp = await fetch(t.url(FEED_URL), {
    cache: force ? 'no-store' : 'default',
    headers: t.headers,
  })
  if (resp.status === 429) {
    // Either hop can throttle. An upstream throttle carries x-final-url.
    const upstream = resp.headers.get('x-final-url') !== null
    const wait = Number(resp.headers.get('retry-after') ?? '')
    const inA = Number.isFinite(wait) && wait > 0 ? `${wait}s` : 'a moment'
    throw new Error(
      upstream
        ? `ForexFactory is rate limiting — try again in ${inA}.`
        : `Rate limited by the ${t.label} — try again in ${inA}.`,
    )
  }
  if (resp.status === 401 || resp.status === 403) {
    // The proxy explains itself in JSON ({"error": "..."}), and it knows more
    // than we can guess — an unregistered origin reads nothing like a bad key.
    let detail = ''
    try {
      const j = JSON.parse(await resp.clone().text()) as { error?: unknown }
      if (typeof j.error === 'string') detail = ` ${j.error}`
    } catch {
      // not JSON — fall back to our own wording
    }
    throw new Error(
      detail
        ? `The ${t.label} refused the request:${detail}`
        : `The ${t.label} refused the request (${resp.status}).`,
    )
  }
  if (!resp.ok) throw new Error(`ForexFactory fetch failed: ${resp.status}`)
  const body = await resp.text()
  let text: string
  try {
    text = t.unwrap(body)
  } catch {
    throw new Error(`Unexpected response from the ${t.label}.`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Faire Economy answers a throttle with an HTML page, sometimes as a 200.
    throw new Error('ForexFactory is rate limiting — try again in a few minutes.')
  }
  if (!Array.isArray(raw)) throw new Error('The news feed returned an unexpected shape.')
  return (raw as Array<Record<string, unknown>>).map(e => ({
    title: String(e.title ?? ''),
    country: String(e.country ?? ''),
    date: String(e.date ?? ''),
    impact: normalizeImpact(e.impact),
    forecast: String(e.forecast ?? ''),
    previous: String(e.previous ?? ''),
  }))
}

/** Walks the transports in order, returning the first that answers. */
async function fetchWeek(force: boolean): Promise<FFEvent[]> {
  // If they all fail, surface the FIRST error: the transports are ordered by
  // preference, so the primary's diagnosis is the useful one, not whatever
  // the last fallback happened to say.
  let first: unknown
  for (const t of TRANSPORTS) {
    try {
      return await fetchVia(t, force)
    } catch (e) {
      first ??= e
    }
  }
  throw first instanceof Error ? first : new Error('Could not reach the news feed.')
}

// -------------------------------------------------------------------- store

function isEventArray(v: unknown): v is FFEvent[] {
  return (
    Array.isArray(v) &&
    v.every(
      e =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as FFEvent).date === 'string' &&
        typeof (e as FFEvent).title === 'string' &&
        typeof (e as FFEvent).impact === 'string',
    )
  )
}

/** The feed week a batch belongs to: the week most of it falls in.
 *
 *  Exported because the archive reconcile needs the same answer: it may only
 *  delete rows inside the week a batch actually speaks for.
 *
 *  Taken from the events rather than from the clock, so the cache is always
 *  labelled with the week it actually describes. By majority rather than by
 *  first or earliest event, because one stray row dated outside the block
 *  would otherwise mislabel the whole week — and a mislabelled week answers
 *  for no day at all, sending the panel to the archive for days the cache is
 *  holding in full. */
export function dominantWeek(events: FFEvent[]): string {
  const tally = new Map<string, number>()
  for (const e of events) {
    const d = new Date(e.date)
    if (Number.isNaN(d.getTime())) continue
    const w = weekStartKey(nyDateKey(d))
    tally.set(w, (tally.get(w) ?? 0) + 1)
  }
  // Ties resolve to the week we are actually in — seeded as the incumbent so
  // nothing can displace it without a strict majority. Insertion order (i.e.
  // whichever event the feed happened to list first) is not a tie-break.
  const best0 = weekStartKey(nyToday())
  let best = best0
  let most = tally.get(best0) ?? 0
  for (const [w, n] of tally) {
    if (n > most) {
      best = w
      most = n
    }
  }
  return best
}

function readStore(): Store {
  try {
    const s = localStorage.getItem(STORE_KEY)
    if (!s) return emptyStore()
    const parsed = JSON.parse(s) as Partial<Store>
    return {
      week: typeof parsed.week === 'string' ? parsed.week : '',
      events: isEventArray(parsed.events) ? parsed.events : [],
      fetchedAt: Number(parsed.fetchedAt) || 0,
      failedAt: Number(parsed.failedAt) || 0,
    }
  } catch {
    // unreadable or unparseable — start clean rather than wedging the panel
    return emptyStore()
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // Quota, which one week of events should never hit. Keep the timestamps
    // so throttling and backoff survive; the events come back on the next
    // fetch anyway, and the archive is untouched either way.
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...store, week: '', events: [] }))
    } catch {
      // storage unavailable entirely — run from memory for this session
    }
  }
}

function snapshot(store: Store): NewsSnapshot {
  return { week: store.week, events: store.events, fetchedAt: store.fetchedAt }
}

// ------------------------------------------------------------------ fetching

// The in-flight request, tagged with whether it was forced. A forced refresh
// must not piggyback on a background one: `force` exists to bypass the HTTP
// cache, and that decision was already made when the other request started.
let inflight: { forced: boolean; promise: Promise<RefreshResult> } | null = null

/** True when we should go to the network, honouring both TTL and backoff. */
function isStale(store: Store): boolean {
  const now = Date.now()
  if (now - store.failedAt < RETRY_MS) return false
  // The freshness window is a floor, and it holds even when the cached week
  // has ended. Between NY rolling into Sunday and the feed rolling with it
  // — hours, most weeks — the stored week is always "last week", and
  // treating that as stale put every single call on the wire against a feed
  // that allows two downloads per five minutes. Refetching cannot conjure a
  // week the feed has not published; waiting out the window can.
  return now - store.fetchedAt > FRESH_MS
}

/** What we already hold, with no network access. */
export function readNews(): NewsSnapshot {
  return snapshot(readStore())
}

/**
 * Returns the stored news, refreshing from the feed first if it's gone stale.
 *
 * Cheap to call from anywhere: inside the freshness window it never touches
 * the network, after a failure it backs off, and concurrent callers share one
 * request rather than each firing their own. That's what keeps a page reloaded
 * fifty times during development down to a handful of requests.
 *
 * `force` (the manual Refresh button) skips every one of those gates.
 */
export async function refreshNews(force = false): Promise<RefreshResult> {
  const store = readStore()
  if (!force && !isStale(store)) return { snapshot: snapshot(store), fetched: null }
  // Share an in-flight request only when it is at least as strong as this
  // one, so pressing Refresh mid-background-fetch still reaches the wire.
  if (inflight && (!force || inflight.forced)) return inflight.promise

  const entry: { forced: boolean; promise: Promise<RefreshResult> } = {
    forced: force,
    promise: null as unknown as Promise<RefreshResult>,
  }
  entry.promise = (async () => {
    try {
      const fetched = await fetchWeek(force)
      // Replace the week outright — no merging into history. Anything worth
      // keeping past this week is already in IndexedDB.
      const next: Store = {
        week: dominantWeek(fetched),
        events: fetched,
        fetchedAt: Date.now(),
        failedAt: 0,
      }
      writeStore(next)
      return { snapshot: snapshot(next), fetched }
    } catch (e) {
      writeStore({ ...readStore(), failedAt: Date.now() })
      throw e
    } finally {
      // Only clear the slot if it's still ours — a forced request can start
      // while a background one is running, and the older finishing later
      // must not wipe the newer one's entry.
      if (inflight === entry) inflight = null
    }
  })()
  inflight = entry
  return entry.promise
}

/** True when the cached week can answer for this NY calendar day. */
export function weekCovers(snap: NewsSnapshot, dayKey: string): boolean {
  return snap.week !== '' && snap.week === weekStartKey(dayKey)
}

/**
 * The cached week bucketed by NY calendar day, each day earliest first.
 *
 * Built once per snapshot rather than scanned per lookup: paging is one
 * arrow click at a time, and bucketing costs one `nyDateKey` per event
 * (an Intl format, the expensive part) instead of 105 of them per click.
 */
export function eventsByDay(snap: NewsSnapshot): Record<string, FFEvent[]> {
  const byDay: Record<string, FFEvent[]> = {}
  for (const e of snap.events) {
    const d = new Date(e.date)
    if (Number.isNaN(d.getTime())) continue // undated row: nothing to file it under
    ;(byDay[nyDateKey(d)] ??= []).push(e)
  }
  for (const events of Object.values(byDay)) {
    events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  }
  return byDay
}
