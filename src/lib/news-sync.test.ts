import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { syncWeekNews } from '@/lib/news-sync'
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
