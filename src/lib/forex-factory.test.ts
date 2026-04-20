import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  eventsOnDay,
  fetchForexFactoryWeek,
  type FFEvent,
} from './forex-factory'

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

describe('eventsOnDay', () => {
  const events: FFEvent[] = [
    sampleEvent({ date: '2026-04-20T23:30:00-04:00', title: 'Late Mon NY' }),
    sampleEvent({ date: '2026-04-21T09:30:00-04:00', title: 'Morning Tue NY' }),
    sampleEvent({ date: '2026-04-21T22:00:00-04:00', title: 'Night Tue NY' }),
    sampleEvent({ date: '2026-04-22T01:00:00-04:00', title: 'Early Wed NY' }),
  ]

  it('returns only events whose NY-calendar date matches the dayKey', () => {
    const tue = eventsOnDay(events, '2026-04-21')
    expect(tue.map(e => e.title)).toEqual(['Morning Tue NY', 'Night Tue NY'])
  })

  it('respects NY timezone for dates straddling UTC midnight', () => {
    // 2026-04-21T03:00:00Z is 2026-04-20 23:00 NY
    const e = sampleEvent({ date: '2026-04-21T03:00:00Z' })
    expect(eventsOnDay([e], '2026-04-20')).toHaveLength(1)
    expect(eventsOnDay([e], '2026-04-21')).toHaveLength(0)
  })

  it('skips entries with an unparseable date', () => {
    const bad = sampleEvent({ date: 'not-a-date' })
    expect(eventsOnDay([bad], '2026-04-21')).toHaveLength(0)
  })
})

describe('fetchForexFactoryWeek', () => {
  const feed = [
    { title: 'CPI y/y', country: 'USD', date: '2026-04-21T08:30:00-04:00', impact: 'High', forecast: '3.2%', previous: '3.0%' },
    { title: 'Retail Sales', country: 'USD', date: '2026-04-23T08:30:00-04:00', impact: 'Medium', forecast: '', previous: '0.4%' },
  ]

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('fetches via the corsproxy and parses the response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(feed), { status: 200 }),
    )
    const out = await fetchForexFactoryWeek('thisweek')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('corsproxy.io')
    expect(url).toContain(encodeURIComponent('ff_calendar_thisweek.json'))
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('CPI y/y')
    expect(out[0].impact).toBe('High')
  })

  it('caches results in localStorage and reads them without a second fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(feed), { status: 200 }),
    )
    await fetchForexFactoryWeek('thisweek')
    await fetchForexFactoryWeek('thisweek')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // Cache key is namespaced per-week.
    expect(localStorage.getItem('logslate:ff:thisweek')).toBeTruthy()
  })

  it('force=true bypasses the cache', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(feed), { status: 200 }),
    )
    await fetchForexFactoryWeek('thisweek')
    await fetchForexFactoryWeek('thisweek', true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('throws on a non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404 }),
    )
    await expect(fetchForexFactoryWeek('nextweek')).rejects.toThrow(/404/)
  })

  it('normalizes unknown impact values to "Low"', async () => {
    const weird = [{ title: 'Weird', country: 'USD', date: '2026-04-21T08:30:00-04:00', impact: 'Catastrophic', forecast: '', previous: '' }]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(weird), { status: 200 }),
    )
    const out = await fetchForexFactoryWeek('lastweek')
    expect(out[0].impact).toBe('Low')
  })

  it('lastweek / thisweek / nextweek each hit the correct feed URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(feed), { status: 200 }),
    )
    await fetchForexFactoryWeek('lastweek')
    await fetchForexFactoryWeek('thisweek')
    await fetchForexFactoryWeek('nextweek')
    const urls = fetchSpy.mock.calls.map(c => decodeURIComponent(String(c[0])))
    expect(urls[0]).toContain('ff_calendar_lastweek.json')
    expect(urls[1]).toContain('ff_calendar_thisweek.json')
    expect(urls[2]).toContain('ff_calendar_nextweek.json')
  })
})
