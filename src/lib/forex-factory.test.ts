import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  eventsByDay,
  readNews,
  refreshNews,
  weekCovers,
  type FFEvent,
  type NewsSnapshot,
} from './forex-factory'
import { weekStartKey } from './tz'

const STORE_KEY = 'logslate:ff:week.v1'
const DAY_MS = 86_400_000

/**
 * An ISO timestamp N days from now, at 12:30 UTC — safely mid-morning in NY,
 * so the UTC and NY calendar days agree. Dates are relative because the cache
 * only holds the CURRENT feed week; fixed dates would fall out of it as soon
 * as the week rolled.
 */
function isoDaysFromNow(n: number): string {
  const d = new Date(Date.now() + n * DAY_MS)
  d.setUTCHours(12, 30, 0, 0)
  return d.toISOString()
}

function nyDayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function sampleEvent(overrides: Partial<FFEvent> = {}): FFEvent {
  return {
    title: 'Sample',
    country: 'USD',
    date: '2026-04-21T14:30:00-04:00',
    impact: 'High',
    forecast: '',
    previous: '',
    ...overrides,
  }
}

/** A snapshot built the way the store builds one, for the pure helpers. */
function snapshotOf(events: FFEvent[]): NewsSnapshot {
  return {
    week: events.length > 0 ? weekStartKey(nyDayOf(events[0].date)) : '',
    events,
    fetchedAt: Date.now(),
  }
}

const dayOf = (snap: NewsSnapshot, day: string) => eventsByDay(snap)[day] ?? []

describe('eventsByDay', () => {
  const events = [
    sampleEvent({ date: '2026-04-20T23:30:00-04:00', title: 'Late Mon NY' }),
    sampleEvent({ date: '2026-04-21T09:30:00-04:00', title: 'Morning Tue NY' }),
    sampleEvent({ date: '2026-04-21T22:00:00-04:00', title: 'Night Tue NY' }),
    sampleEvent({ date: '2026-04-22T01:00:00-04:00', title: 'Early Wed NY' }),
  ]

  it('returns only the given NY day, earliest first', () => {
    const tue = dayOf(snapshotOf(events), '2026-04-21')
    expect(tue.map(e => e.title)).toEqual(['Morning Tue NY', 'Night Tue NY'])
  })

  it('returns an empty array for a day we hold nothing for', () => {
    expect(dayOf(snapshotOf(events), '2026-04-25')).toEqual([])
  })
})

describe('weekCovers', () => {
  // 2026-04-21 is a Tuesday: its feed week runs Sun 19th - Sat 25th.
  const snap = snapshotOf([sampleEvent({ date: '2026-04-21T09:30:00-04:00' })])

  it('covers every day of the cached week, events or not', () => {
    expect(weekCovers(snap, '2026-04-19')).toBe(true)
    expect(weekCovers(snap, '2026-04-21')).toBe(true)
    expect(weekCovers(snap, '2026-04-25')).toBe(true)
  })

  it('covers nothing outside it — those days belong to the archive', () => {
    expect(weekCovers(snap, '2026-04-18')).toBe(false)
    expect(weekCovers(snap, '2026-04-26')).toBe(false)
  })

  it('covers nothing at all when the cache is empty', () => {
    expect(weekCovers({ week: '', events: [], fetchedAt: 0 }, '2026-04-21')).toBe(false)
  })
})

describe('refreshNews', () => {
  const dayA = isoDaysFromNow(0)
  const dayB = isoDaysFromNow(2)
  const feed = [
    { title: 'CPI y/y', country: 'USD', date: dayA, impact: 'High', forecast: '3.2%', previous: '3.0%' },
    { title: 'Retail Sales', country: 'USD', date: dayB, impact: 'Medium', forecast: '', previous: '0.4%' },
  ]

  /** Answers whichever transport asked, in the shape that transport expects. */
  function mockBoth(events: unknown = feed) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const json = JSON.stringify(events)
      return String(input).includes('r.jina.ai')
        ? new Response(JSON.stringify({ data: { content: json } }), { status: 200 })
        : new Response(json, { status: 200 })
    })
  }

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('fetches via the corsproxy, parses, and buckets by NY day', async () => {
    const spy = mockBoth()
    const { snapshot, fetched } = await refreshNews()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0][0])).toContain('corsproxy.io')
    expect(String(spy.mock.calls[0][0])).toContain(encodeURIComponent('ff_calendar_thisweek.json'))
    expect(fetched).toHaveLength(2)
    expect(snapshot.events).toHaveLength(2)
    expect(snapshot.week).toBe(weekStartKey(nyDayOf(dayA)))
    expect(dayOf(snapshot, nyDayOf(dayA))[0].impact).toBe('High')
  })

  it('serves the stored copy without a request while it is fresh', async () => {
    const spy = mockBoth()
    await refreshNews()
    const second = await refreshNews()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(second.fetched).toBeNull()
    expect(second.snapshot.events).toHaveLength(2)
  })

  it('force=true refetches and bypasses the browser HTTP cache', async () => {
    const spy = mockBoth()
    await refreshNews()
    await refreshNews(true)

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0][1]).toMatchObject({ cache: 'default' })
    expect(spy.mock.calls[1][1]).toMatchObject({ cache: 'no-store' })
  })

  it('shares one request between concurrent callers', async () => {
    const spy = mockBoth()
    const [a, b] = await Promise.all([refreshNews(), refreshNews()])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(a.snapshot.events).toEqual(b.snapshot.events)
  })

  it('does not let a forced refresh piggyback on a background one', async () => {
    // Refresh exists to bypass the HTTP cache. Joining an in-flight default
    // fetch would hand back a possibly-cached response from the one button
    // whose entire job is going to the wire.
    let release: (() => void) | undefined
    const gate = new Promise<void>(r => (release = r))
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      await gate
      const json = JSON.stringify(feed)
      return String(input).includes('r.jina.ai')
        ? new Response(JSON.stringify({ data: { content: json } }), { status: 200 })
        : new Response(json, { status: 200 })
    })

    const background = refreshNews()
    const forced = refreshNews(true)
    release!()
    await Promise.all([background, forced])

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls.map(c => (c[1] as RequestInit).cache).sort()).toEqual([
      'default',
      'no-store',
    ])
  })

  it('still shares one request between concurrent forced callers', async () => {
    const spy = mockBoth()
    const [a, b] = await Promise.all([refreshNews(true), refreshNews(true)])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(a.snapshot.events).toEqual(b.snapshot.events)
  })

  it('replaces the cached week outright rather than merging into it', async () => {
    mockBoth()
    await refreshNews()

    // A fresh fetch of the same week: one event revised, one gone.
    mockBoth([
      { title: 'CPI y/y (revised)', country: 'USD', date: dayA, impact: 'High', forecast: '', previous: '' },
    ])
    const { snapshot } = await refreshNews(true)

    // Nothing accumulates. The cache is one week, and the week is whatever
    // the feed last said — anything worth keeping is in IndexedDB by now.
    expect(snapshot.events.map(e => e.title)).toEqual(['CPI y/y (revised)'])
    expect(dayOf(snapshot, nyDayOf(dayB))).toEqual([])
  })

  it('does not refetch a just-fetched week merely because it has ended', async () => {
    const spy = mockBoth()
    await refreshNews()
    expect(spy).toHaveBeenCalledTimes(1)

    // Age the stored week by one without touching `fetchedAt`: the copy is
    // seconds old but describes a week that has ended. This is every Sunday
    // between NY rolling over and the feed rolling with it, and the feed
    // cannot hand back a week it has not published yet — so the freshness
    // window must still hold, or every call in those hours hits the wire.
    const stored = JSON.parse(localStorage.getItem(STORE_KEY)!) as { week: string }
    const lastWeek = new Date(`${stored.week}T12:00:00Z`)
    lastWeek.setUTCDate(lastWeek.getUTCDate() - 7)
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ ...stored, week: lastWeek.toISOString().slice(0, 10) }),
    )

    await refreshNews()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('labels the cached week by majority, not by whichever event came first', async () => {
    // A stray row dated in the previous week, listed first. Taking the week
    // from it would mislabel the whole batch, and a mislabelled week covers
    // no day at all — the panel would fall through to the archive for days
    // the cache is holding in full.
    mockBoth([
      { title: 'Stray', country: 'USD', date: isoDaysFromNow(-9), impact: 'Low', forecast: '', previous: '' },
      ...feed,
    ])
    const { snapshot } = await refreshNews()
    expect(snapshot.week).toBe(weekStartKey(nyDayOf(dayA)))
    expect(weekCovers(snapshot, nyDayOf(dayA))).toBe(true)
  })

  it('backs off after a failure instead of retrying on every call', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 500 }),
    )
    await expect(refreshNews()).rejects.toThrow()
    const callsAfterFailure = spy.mock.calls.length

    // A reload moments later must not hit the network again.
    await expect(refreshNews()).resolves.toMatchObject({ fetched: null })
    expect(spy).toHaveBeenCalledTimes(callsAfterFailure)
  })

  it('force overrides the failure backoff', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }))
    await expect(refreshNews()).rejects.toThrow()

    const spy = mockBoth()
    const { fetched } = await refreshNews(true)
    expect(fetched).toHaveLength(2)
    expect(spy).toHaveBeenCalled()
  })

  it('falls back to the reader when the corsproxy refuses', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('corsproxy.io')) {
        return new Response('{"error":"Origin not registered"}', { status: 403 })
      }
      return new Response(JSON.stringify({ data: { content: JSON.stringify(feed) } }))
    })

    const { fetched } = await refreshNews()
    expect(fetched?.map(e => e.title)).toEqual(['CPI y/y', 'Retail Sales'])
    expect(String(spy.mock.calls[1]?.[0])).toContain('r.jina.ai')
  })

  it('blames the feed, not the proxy, when the 429 came from upstream', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<html>Rate Limited</html>', {
        status: 429,
        headers: {
          'x-final-url': 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
          'retry-after': '60',
        },
      }),
    )
    await expect(refreshNews()).rejects.toThrow(/ForexFactory is rate limiting — try again in 60s/)
  })

  it('reads an upstream HTML throttle page served as a 200 as a rate limit', async () => {
    // Faire Economy answers a throttle with HTML, sometimes as a 200. The
    // reader wraps that page verbatim, so the giveaway is the unparseable body.
    const html = '<!DOCTYPE html><title>Rate Limited</title>'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input =>
      String(input).includes('r.jina.ai')
        ? new Response(JSON.stringify({ data: { content: html } }), { status: 200 })
        : new Response(html, { status: 200 }),
    )
    await expect(refreshNews()).rejects.toThrow(/rate limiting/i)
  })

  it("passes through the proxy's own explanation of a 403", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('{"error":"This request\'s Origin or Referer is not registered."}', {
        status: 403,
      }),
    )
    await expect(refreshNews()).rejects.toThrow(/Origin or Referer is not registered/)
  })

  it('rejects a feed that is not an array rather than storing junk', async () => {
    mockBoth({ not: 'an array' })
    await expect(refreshNews()).rejects.toThrow(/unexpected shape/i)
    expect(readNews().events).toEqual([])
  })

  it('survives a corrupt store instead of wedging the panel', () => {
    localStorage.setItem(STORE_KEY, '{ this is not json')
    expect(readNews()).toEqual({ week: '', events: [], fetchedAt: 0 })
  })
})

describe('malformed feed rows', () => {
  beforeEach(() => localStorage.clear())

  it('keeps a row with missing fields rather than dropping the whole week', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const json = JSON.stringify([
        { title: 'Good', country: 'USD', date: isoDaysFromNow(0), impact: 'High', forecast: '', previous: '' },
        { title: 'Bare' }, // no country, date or impact at all
        { title: 'Odd impact', country: 'USD', date: isoDaysFromNow(0), impact: 'Non-Economic' },
      ])
      return String(input).includes('r.jina.ai')
        ? new Response(JSON.stringify({ data: { content: json } }), { status: 200 })
        : new Response(json, { status: 200 })
    })
    const { snapshot } = await refreshNews()
    // All three are stored; the undated one simply files under no day, and
    // an impact we have no dot for reads as Low.
    expect(snapshot.events).toHaveLength(3)
    expect(snapshot.events[2].impact).toBe('Low')
    expect(snapshot.events[1]).toMatchObject({ title: 'Bare', country: '', date: '' })
    // The undated row must not appear on, or break, any day.
    const today = nyDayOf(isoDaysFromNow(0))
    expect(eventsByDay(snapshot)[today].map(e => e.title)).toEqual(['Good', 'Odd impact'])
  })

  it('survives a stored week whose events are not an array', () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ week: '2026-05-10', events: 'nope', fetchedAt: 5 }))
    expect(readNews()).toEqual({ week: '2026-05-10', events: [], fetchedAt: 5 })
  })
})
