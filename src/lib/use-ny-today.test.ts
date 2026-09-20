import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNyToday } from './use-ny-today'

// September is EDT (UTC-4), so 03:59Z is 23:59 the previous NY day.
const BEFORE_MIDNIGHT = new Date('2026-09-21T03:59:00Z')

describe('useNyToday', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(BEFORE_MIDNIGHT)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts on the current NY day', () => {
    const { result } = renderHook(() => useNyToday())
    expect(result.current).toBe('2026-09-20')
  })

  it('rolls over when NY midnight passes with the page open', () => {
    const { result } = renderHook(() => useNyToday())
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(result.current).toBe('2026-09-21')
  })

  it('keeps the same string while the day does not change', () => {
    vi.setSystemTime(new Date('2026-09-20T15:00:00Z')) // 11:00 in NY
    const { result } = renderHook(() => useNyToday())
    const first = result.current
    act(() => {
      vi.advanceTimersByTime(30 * 60_000)
    })
    // Still the 20th in NY — same value, so nothing downstream recomputes.
    expect(result.current).toBe(first)
    expect(first).toBe('2026-09-20')
  })

  it('re-checks when the tab comes back, without waiting for a tick', () => {
    const { result } = renderHook(() => useNyToday())
    // A frozen tab gets no timers at all: jump the clock without running them.
    vi.setSystemTime(new Date('2026-09-21T04:01:00Z'))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe('2026-09-21')
  })

  it('stops ticking once unmounted', () => {
    const { result, unmount } = renderHook(() => useNyToday())
    unmount()
    vi.setSystemTime(new Date('2026-09-21T04:01:00Z'))
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(result.current).toBe('2026-09-20')
  })
})
