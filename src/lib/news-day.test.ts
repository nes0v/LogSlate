import { describe, expect, it } from 'vitest'
import { lastReachableDay, newsDayMode } from '@/lib/news-day'

// Fixed dates, because every rule here answers differently depending on the
// weekday it is asked on. 2026-09-13 is a Sunday, so the feed week it opens
// runs through Saturday 2026-09-19.
const SUN = '2026-09-13'
const WED = '2026-09-16'
const SAT = '2026-09-19'
const NEXT_SUN = '2026-09-20'

describe('newsDayMode', () => {
  it('calls every day of the feed week current, asked from midweek', () => {
    expect(newsDayMode(SUN, WED)).toBe('current')
    expect(newsDayMode(WED, WED)).toBe('current')
    expect(newsDayMode(SAT, WED)).toBe('current')
  })

  it('puts the day before the feed week in the archive', () => {
    expect(newsDayMode('2026-09-12', WED)).toBe('archive')
    expect(newsDayMode('2026-07-14', WED)).toBe('archive')
  })

  it('treats the Sunday after the feed week as unpublished, not archived', () => {
    expect(newsDayMode(NEXT_SUN, SAT)).toBe('unpublished')
  })

  it('moves the whole block back one mode as soon as the feed rolls', () => {
    // Asked on the new Sunday, last week's Saturday is archive and the
    // Sunday itself is current — the feed has rolled onto its week.
    expect(newsDayMode(SAT, NEXT_SUN)).toBe('archive')
    expect(newsDayMode(NEXT_SUN, NEXT_SUN)).toBe('current')
    expect(newsDayMode('2026-09-26', NEXT_SUN)).toBe('current')
  })
})

describe('lastReachableDay', () => {
  it('reaches the Sunday that closes the week, from any weekday', () => {
    expect(lastReachableDay(WED)).toBe(NEXT_SUN)
    expect(lastReachableDay(SAT)).toBe(NEXT_SUN)
    expect(lastReachableDay('2026-09-14')).toBe(NEXT_SUN) // Monday
  })

  it('reaches past the new feed week to its Sunday, asked on a Sunday', () => {
    // The feed has just rolled onto Sun 20 - Sat 26. Stopping at "today"
    // would hide six published days; stopping at the feed's Saturday ends
    // the week a day early for a reader who reads weeks Mon-Sun.
    expect(lastReachableDay(NEXT_SUN)).toBe('2026-09-27')
  })

  it('always includes today', () => {
    for (const day of [SUN, WED, SAT, NEXT_SUN]) {
      expect(lastReachableDay(day) >= day).toBe(true)
    }
  })
})
