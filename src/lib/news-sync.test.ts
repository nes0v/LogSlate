import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { readArchivedWeek, syncWeekNews } from '@/lib/news-sync'
import type { FFEvent } from '@/lib/forex-factory'

function ff(partial: Partial<FFEvent> & { date: string }): FFEvent {
  return {
    title: 'Some Event',
    country: 'USD',
    impact: 'High',
    forecast: '',
    previous: '',
    ...partial,
  }
}

beforeEach(async () => {
  await db.news.clear()
})
afterEach(async () => {
  await db.news.clear()
})

describe('syncWeekNews', () => {
  it('persists USD high/medium events and ignores low-impact / non-USD', async () => {
    await syncWeekNews([
      ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z', impact: 'High' }),
      ff({ title: 'Some Low', date: '2026-05-12T14:00:00.000Z', impact: 'Low' }),
      ff({ title: 'EUR PMI', date: '2026-05-13T08:00:00.000Z', country: 'EUR', impact: 'High' }),
    ])
    const rows = await db.news.toArray()
    expect(rows.map(r => r.title)).toEqual(['CPI'])
  })

  it('clears stale events even on a week with zero USD high/medium events', async () => {
    // Week 1: a high-impact event gets persisted.
    await syncWeekNews([ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z', impact: 'High' })])
    expect(await db.news.count()).toBe(1)

    // Re-fetch of the SAME week now returns only low-impact / non-USD events
    // (the High event was cancelled). The covered range still spans the week,
    // so the stale CPI row must be deleted rather than lingering.
    await syncWeekNews([
      ff({ title: 'Holiday', date: '2026-05-11T00:00:00.000Z', impact: 'Low' }),
      ff({ title: 'EUR Speech', date: '2026-05-13T09:00:00.000Z', country: 'EUR', impact: 'High' }),
    ])
    expect(await db.news.count()).toBe(0)
  })

  it('does nothing when the feed returns no events at all', async () => {
    await syncWeekNews([ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z', impact: 'High' })])
    await syncWeekNews([])
    // No range to act on → the prior week's data is left untouched.
    expect(await db.news.count()).toBe(1)
  })
})

describe('syncWeekNews identity', () => {
  it('keeps two events that share a title on the same day', async () => {
    // A speaker appearing twice in one day. Keying on day + title alone kept
    // only whichever row happened to be written last.
    await syncWeekNews([
      ff({ title: 'FOMC Member Speaks', date: '2026-05-12T13:00:00.000Z', impact: 'Medium', forecast: 'morning' }),
      ff({ title: 'FOMC Member Speaks', date: '2026-05-12T20:00:00.000Z', impact: 'Medium', forecast: 'evening' }),
    ])
    const rows = await db.news.orderBy('id').toArray()
    expect(rows.map(r => r.forecast).sort()).toEqual(['evening', 'morning'])
  })

  it("leaves a row's updated_at alone when the feed still says the same thing", async () => {
    const week = [ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z' })]
    await syncWeekNews(week)
    const before = (await db.news.toArray())[0]
    await new Promise(r => setTimeout(r, 2))
    await syncWeekNews(week)
    const after = (await db.news.toArray())[0]
    expect(after.updated_at).toBe(before.updated_at)
    expect(after.created_at).toBe(before.created_at)
  })

  it('rewrites a row when the feed revises it', async () => {
    await syncWeekNews([ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z', forecast: '0.2%' })])
    const before = (await db.news.toArray())[0]
    // updated_at has millisecond resolution; two back-to-back calls would
    // otherwise land on the same stamp and prove nothing.
    await new Promise(r => setTimeout(r, 2))
    await syncWeekNews([ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z', forecast: '0.3%', previous: '0.2%' })])
    const after = (await db.news.toArray())[0]
    expect(after.forecast).toBe('0.3%')
    expect(after.updated_at).not.toBe(before.updated_at)
    expect(after.created_at).toBe(before.created_at)
  })

  it('re-mirroring a months-wide snapshot leaves untouched weeks alone', async () => {
    // A day archived by an earlier fetch.
    await syncWeekNews([ff({ title: 'June NFP', date: '2026-06-05T12:30:00.000Z' })])
    // The whole stored snapshot gets mirrored back. It straddles June but
    // says nothing about that week, so that week must survive intact.
    await syncWeekNews([
      ff({ title: 'May CPI', date: '2026-05-12T12:30:00.000Z' }),
      ff({ title: 'Jul CPI', date: '2026-07-14T12:30:00.000Z' }),
    ])
    expect((await readArchivedWeek('2026-05-31'))['2026-06-05'].map(e => e.title)).toEqual([
      'June NFP',
    ])
  })
})

describe('readArchivedWeek', () => {
  it('returns the week grouped by day, each day in time order', async () => {
    await syncWeekNews([
      ff({ title: 'PPI', date: '2026-05-12T14:00:00.000Z', impact: 'Medium', forecast: '0.2%', previous: '0.1%' }),
      ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z', impact: 'High' }),
      ff({ title: 'Next day', date: '2026-05-13T12:30:00.000Z' }),
    ])
    // Tue 2026-05-12 sits in the week opening Sun 2026-05-10.
    const week = await readArchivedWeek('2026-05-10')
    expect(Object.keys(week).sort()).toEqual(['2026-05-12', '2026-05-13'])
    expect(week['2026-05-12'].map(e => e.title)).toEqual(['CPI', 'PPI'])
    expect(week['2026-05-12'][1]).toEqual({
      title: 'PPI',
      country: 'USD',
      date: '2026-05-12T14:00:00.000Z',
      impact: 'Medium',
      forecast: '0.2%',
      previous: '0.1%',
    })
  })

  it('returns an empty week for one the archive never held', async () => {
    expect(await readArchivedWeek('2026-05-10')).toEqual({})
  })

  it('does not bleed into the neighbouring weeks', async () => {
    await syncWeekNews([ff({ title: 'Sat', date: '2026-05-16T12:30:00.000Z' })])
    await syncWeekNews([ff({ title: 'Sun', date: '2026-05-17T12:30:00.000Z' })])
    expect(Object.keys(await readArchivedWeek('2026-05-10'))).toEqual(['2026-05-16'])
    expect(Object.keys(await readArchivedWeek('2026-05-17'))).toEqual(['2026-05-17'])
  })
})

describe('syncWeekNews blast radius', () => {
  it('a stray event dated outside the batch cannot empty its week', async () => {
    // A week's worth of archive, built by earlier fetches.
    await syncWeekNews([
      ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z' }),
      ff({ title: 'PPI', date: '2026-05-13T12:30:00.000Z' }),
      ff({ title: 'NFP', date: '2026-05-15T12:30:00.000Z' }),
    ])
    expect(await db.news.count()).toBe(3)

    // The next week's fetch, carrying one row misdated into the week before.
    // That row is evidence that it exists — not evidence that nothing else
    // in that week does.
    await syncWeekNews([
      ff({ title: 'Stray', date: '2026-05-13T09:00:00.000Z' }),
      ff({ title: 'Next CPI', date: '2026-05-19T12:30:00.000Z' }),
      ff({ title: 'Next PPI', date: '2026-05-20T12:30:00.000Z' }),
    ])

    const kept = await db.news.orderBy('date').toArray()
    expect(kept.map(r => r.title).sort()).toEqual([
      'CPI', 'NFP', 'Next CPI', 'Next PPI', 'PPI', 'Stray',
    ])
  })

  it('still clears a cancelled release inside the week it speaks for', async () => {
    await syncWeekNews([
      ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z' }),
      ff({ title: 'Doomed', date: '2026-05-13T12:30:00.000Z' }),
    ])
    await syncWeekNews([ff({ title: 'CPI', date: '2026-05-12T12:30:00.000Z' })])
    expect((await db.news.toArray()).map(r => r.title)).toEqual(['CPI'])
  })
})
