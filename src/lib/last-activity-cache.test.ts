import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isDateKey } from './tz'
import {
  clearLastActivityDate,
  readLastActivityDate,
  writeLastActivityDate,
} from './last-activity-cache'

const KEY = (id: string) => `logslate:last_activity_date:${id}`

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('isDateKey', () => {
  it('accepts real calendar dates', () => {
    for (const v of ['2026-07-31', '2024-02-29', '2026-01-01', '2026-12-31']) {
      expect(isDateKey(v), v).toBe(true)
    }
  })

  it('rejects well-shaped but impossible dates', () => {
    // These parse to an Invalid Date, which throws `RangeError: Invalid time
    // value` as soon as date-fns formats it — mid-render, taking the page down.
    for (const v of ['2026-13-45', '2026-00-10', '2026-07-32', '2026-13-01']) {
      expect(isDateKey(v), v).toBe(false)
    }
  })

  it('rejects dates that silently roll over', () => {
    // The dangerous class: `new Date('2026-02-30')` does NOT fail, it becomes
    // 2026-03-01. Only the round-trip catches it.
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(isDateKey('2025-02-29')).toBe(false) // 2025 isn't a leap year
    expect(isDateKey('2026-04-31')).toBe(false) // April has 30 days
  })

  it('rejects wrong shapes and non-strings', () => {
    for (const v of ['', '2026-1-1', '31-07-2026', '2026/07/31', '2026-07-31T00:00:00', 'garbage']) {
      expect(isDateKey(v), String(v)).toBe(false)
    }
    for (const v of [null, undefined, 12345, {}, [], true]) {
      expect(isDateKey(v), String(v)).toBe(false)
    }
  })
})

describe('last-activity cache', () => {
  it('round-trips a date', () => {
    writeLastActivityDate('main', '2026-07-31')
    expect(readLastActivityDate('main')).toBe('2026-07-31')
  })

  it('returns null when absent', () => {
    expect(readLastActivityDate('main')).toBeNull()
  })

  it('keys per account so one never seeds another', () => {
    writeLastActivityDate('main', '2026-07-31')
    writeLastActivityDate('second', '2025-06-26')
    expect(readLastActivityDate('main')).toBe('2026-07-31')
    expect(readLastActivityDate('second')).toBe('2025-06-26')
    expect(readLastActivityDate('third')).toBeNull()
  })

  it('clears only the named account', () => {
    writeLastActivityDate('main', '2026-07-31')
    writeLastActivityDate('second', '2025-06-26')
    clearLastActivityDate('main')
    expect(readLastActivityDate('main')).toBeNull()
    expect(readLastActivityDate('second')).toBe('2025-06-26')
  })

  it('rejects every corrupt stored value rather than passing it on', () => {
    // localStorage is user-editable and outlives app versions, so the read
    // path treats it as untrusted. Anything unusable reads as null, which
    // just means the pickers show "Any" for a frame.
    const corrupt = [
      'not json at all',
      '12345',
      '{"a":1}',
      '[]',
      'null',
      '""',
      '"2026-13-45"', // crashed the Overview route before `isDateKey`
      '"2026-02-30"', // rolls over to 2026-03-01
      '"31-07-2026"',
      `"${'x'.repeat(5000)}"`,
    ]
    for (const raw of corrupt) {
      localStorage.setItem(KEY('main'), raw)
      expect(readLastActivityDate('main'), raw).toBeNull()
    }
  })

  it('survives localStorage being unavailable', () => {
    const boom = () => { throw new DOMException('QuotaExceededError') }
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
    })
    try {
      expect(() => writeLastActivityDate('main', '2026-07-31')).not.toThrow()
      expect(() => clearLastActivityDate('main')).not.toThrow()
      expect(readLastActivityDate('main')).toBeNull()
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
