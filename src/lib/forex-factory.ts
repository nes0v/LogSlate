// Economic calendar data from ForexFactory's weekly JSON feed (served by
// Faire Economy). The feed doesn't send CORS headers, so we bounce it
// through corsproxy.io, which as of 2026-08 rejects unkeyed requests with a
// 401. The key is a build-time env var; it ships in the bundle like any
// client-only credential, so lock it to this app's origins in the corsproxy
// dashboard. Cached in localStorage with a 15 min TTL to keep the proxy usage
// low and to work offline for a bit.

import { nyDateKey } from '@/lib/tz'

export type FFWeek = 'lastweek' | 'thisweek' | 'nextweek'

const FEED_URL_BY_WEEK: Record<FFWeek, string> = {
  lastweek: 'https://nfs.faireconomy.media/ff_calendar_lastweek.json',
  thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
}

const PROXY_KEY = (import.meta.env.VITE_CORSPROXY_KEY ?? '').trim()

function proxied(url: string): string {
  const key = PROXY_KEY ? `key=${encodeURIComponent(PROXY_KEY)}&` : ''
  return `https://corsproxy.io/?${key}url=${encodeURIComponent(url)}`
}

const CACHE_KEY_BY_WEEK: Record<FFWeek, string> = {
  lastweek: 'logslate:ff:lastweek',
  thisweek: 'logslate:ff:thisweek',
  nextweek: 'logslate:ff:nextweek',
}
const CACHE_TTL_MS = 15 * 60 * 1000

export type FFImpact = 'High' | 'Medium' | 'Low' | 'Holiday'

export interface FFEvent {
  title: string
  country: string // e.g. "USD", "EUR", "ALL"
  date: string // ISO 8601
  impact: FFImpact
  forecast: string
  previous: string
}

interface CacheEntry {
  at: number
  events: FFEvent[]
}

function loadCache(key: string): CacheEntry | null {
  try {
    const s = localStorage.getItem(key)
    if (!s) return null
    const c = JSON.parse(s) as CacheEntry
    if (Date.now() - c.at > CACHE_TTL_MS) return null
    return c
  } catch {
    return null
  }
}

function saveCache(key: string, events: FFEvent[]): void {
  try {
    const entry: CacheEntry = { at: Date.now(), events }
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // storage full or unavailable — ignore
  }
}

function normalizeImpact(s: unknown): FFImpact {
  const v = String(s ?? '').trim()
  if (v === 'High' || v === 'Medium' || v === 'Low' || v === 'Holiday') return v
  return 'Low'
}

async function fetchFeed(url: string, force = false): Promise<FFEvent[]> {
  // On a manual refresh, bypass the browser HTTP cache too — corsproxy.io
  // returns a cacheable response, so a default fetch would be served from
  // memory/disk cache and never hit the wire.
  const resp = await fetch(proxied(url), {
    cache: force ? 'no-store' : 'default',
  })
  if (resp.status === 429) {
    throw new Error('Rate limited by the news proxy — wait a moment before refreshing again.')
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      PROXY_KEY
        ? 'The news proxy rejected this key — check it is active and this origin is listed in the corsproxy.io dashboard.'
        : 'The news proxy needs an API key. Set VITE_CORSPROXY_KEY in .env.local and rebuild.',
    )
  }
  if (!resp.ok) throw new Error(`ForexFactory fetch failed: ${resp.status}`)
  // Faire Economy throttles by IP and answers with an HTML "Rate Limited"
  // page, which the proxy passes through as a 200. Sniff the body rather than
  // the content-type so it reads as a rate limit, not a JSON parse error.
  const body = await resp.text()
  let raw: Array<Record<string, unknown>>
  try {
    raw = JSON.parse(body) as Array<Record<string, unknown>>
  } catch {
    throw new Error('ForexFactory is rate limiting — wait a few minutes and refresh.')
  }
  return raw.map(e => ({
    title: String(e.title ?? ''),
    country: String(e.country ?? ''),
    date: String(e.date ?? ''),
    impact: normalizeImpact(e.impact),
    forecast: String(e.forecast ?? ''),
    previous: String(e.previous ?? ''),
  }))
}

/** Fetches one of the 3 available weekly feeds (cached per-week for 15 min). */
export async function fetchForexFactoryWeek(week: FFWeek, force = false): Promise<FFEvent[]> {
  const cacheKey = CACHE_KEY_BY_WEEK[week]
  if (!force) {
    const cached = loadCache(cacheKey)
    if (cached) return cached.events
  }
  const events = await fetchFeed(FEED_URL_BY_WEEK[week], force)
  saveCache(cacheKey, events)
  return events
}

/** Returns events whose `date` falls on the given NY-calendar day (YYYY-MM-DD). */
export function eventsOnDay(events: FFEvent[], dayKey: string): FFEvent[] {
  return events.filter(e => {
    const d = new Date(e.date)
    if (Number.isNaN(d.getTime())) return false
    return nyDateKey(d) === dayKey
  })
}
