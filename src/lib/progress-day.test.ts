import { describe, expect, it } from 'vitest'
import {
  canEditRulesOn,
  canNavigateTo,
  isFutureDay,
  landingDayFor,
  marketOpenOn,
  nextSessionFor,
} from './progress-day'

// One week, named once so every case below reads as a weekday rather than a
// number. PREV_TUE sits BEFORE the run; TUE is the Tuesday after it.
//   2026-09-15 Tue | 16 Wed · 17 Thu · 18 Fri · 19 Sat · 20 Sun · 21 Mon · 22 Tue
const PREV_TUE = '2026-09-15'
const WED = '2026-09-16'
const THU = '2026-09-17'
const FRI = '2026-09-18'
const SAT = '2026-09-19'
const SUN = '2026-09-20'
const MON = '2026-09-21'
const TUE = '2026-09-22'

describe('marketOpenOn', () => {
  it('is true on weekdays, false at the weekend', () => {
    expect(marketOpenOn(WED)).toBe(true)
    expect(marketOpenOn(FRI)).toBe(true)
    expect(marketOpenOn(SAT)).toBe(false)
    expect(marketOpenOn(SUN)).toBe(false)
  })
})

describe('landingDayFor', () => {
  it('is today on a weekday', () => {
    expect(landingDayFor(WED)).toBe(WED)
    expect(landingDayFor(MON)).toBe(MON)
  })

  it('rolls back to Friday across the weekend', () => {
    expect(landingDayFor(SAT)).toBe(FRI)
    expect(landingDayFor(SUN)).toBe(FRI)
  })
})

describe('nextSessionFor', () => {
  it('is tomorrow mid-week', () => {
    expect(nextSessionFor(WED)).toBe(THU)
  })

  it('jumps the weekend from Friday onward', () => {
    expect(nextSessionFor(FRI)).toBe(MON)
    expect(nextSessionFor(SAT)).toBe(MON)
    expect(nextSessionFor(SUN)).toBe(MON)
  })

  it('never lands on a weekend, whichever day it is asked about', () => {
    for (const d of [WED, THU, FRI, SAT, SUN, MON, TUE]) {
      expect(marketOpenOn(nextSessionFor(d))).toBe(true)
    }
  })

  it('always moves strictly forward', () => {
    for (const d of [WED, THU, FRI, SAT, SUN, MON, TUE]) {
      expect(nextSessionFor(d) > d).toBe(true)
    }
  })
})

describe('canEditRulesOn', () => {
  it('mid-week: today and tomorrow, nothing else', () => {
    expect(canEditRulesOn(WED, WED)).toBe(true) // today
    expect(canEditRulesOn(THU, WED)).toBe(true) // next session
    expect(canEditRulesOn(PREV_TUE, WED)).toBe(false) // yesterday
    expect(canEditRulesOn(FRI, WED)).toBe(false) // two days out
  })

  it('on a weekend, ONLY Monday — Friday is over and locks', () => {
    for (const today of [SAT, SUN]) {
      expect(canEditRulesOn(MON, today)).toBe(true)
      expect(canEditRulesOn(FRI, today)).toBe(false)
      // ...even though Friday is where the page lands.
      expect(landingDayFor(today)).toBe(FRI)
    }
  })

  it('never unlocks the calendar day itself at the weekend', () => {
    expect(canEditRulesOn(SAT, SAT)).toBe(false)
    expect(canEditRulesOn(SUN, SUN)).toBe(false)
  })

  it('Friday can plan Monday', () => {
    expect(canEditRulesOn(FRI, FRI)).toBe(true)
    expect(canEditRulesOn(MON, FRI)).toBe(true)
  })

  it('a past day is never editable', () => {
    expect(canEditRulesOn(WED, MON)).toBe(false)
    expect(canEditRulesOn(FRI, MON)).toBe(false)
  })
})

describe('isFutureDay', () => {
  it('is true only past the calendar day', () => {
    expect(isFutureDay(THU, WED)).toBe(true)
    expect(isFutureDay(WED, WED)).toBe(false)
    expect(isFutureDay(PREV_TUE, WED)).toBe(false)
  })

  it('treats the next session as future when planning at the weekend', () => {
    // Monday's checklist is a preview on Sunday — editable rules, no ticking.
    expect(isFutureDay(MON, SUN)).toBe(true)
    expect(canEditRulesOn(MON, SUN)).toBe(true)
  })
})

describe('canNavigateTo', () => {
  it('stops at the next session', () => {
    expect(canNavigateTo(THU, WED)).toBe(true)
    expect(canNavigateTo(FRI, WED)).toBe(false)
  })

  it('leaves the past unbounded', () => {
    expect(canNavigateTo(PREV_TUE, WED)).toBe(true)
    expect(canNavigateTo('2020-01-02', WED)).toBe(true)
  })

  it('lets a weekend reach Monday but no further', () => {
    expect(canNavigateTo(MON, SAT)).toBe(true)
    expect(canNavigateTo(TUE, SAT)).toBe(false)
  })

  it('agrees with the edit gate on where the edge is', () => {
    // Everything editable must be reachable, or the gate is unusable.
    for (const today of [WED, THU, FRI, SAT, SUN, MON]) {
      for (const d of [WED, THU, FRI, SAT, SUN, MON, TUE]) {
        if (canEditRulesOn(d, today)) expect(canNavigateTo(d, today)).toBe(true)
      }
    }
  })
})
