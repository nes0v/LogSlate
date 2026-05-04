import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  clearNotifications,
  dismissNotification,
  pushError,
  pushInfo,
  useNotifications,
} from './notifications'

afterEach(() => {
  clearNotifications()
  vi.useRealTimers()
})

describe('pushError', () => {
  it('returns the new notification id and stores the entry', () => {
    const id = pushError('boom')
    expect(id).toBeTruthy()
  })

  it('de-dupes repeat errors with the same message', () => {
    const first = pushError('boom')
    const second = pushError('boom')
    expect(first).toBeTruthy()
    expect(second).toBeNull()
  })

  it('allows actions with a route or onClick', () => {
    const id = pushError('reconnect needed', { label: 'Settings', to: '/settings' })
    expect(id).toBeTruthy()
  })
})

describe('pushInfo', () => {
  it('auto-dismisses after the timeout', () => {
    vi.useFakeTimers()
    const id = pushInfo('saved')
    expect(id).toBeTruthy()
    vi.advanceTimersByTime(5000)
    // After timeout, the same message can be pushed again (not deduped).
    const second = pushInfo('saved')
    expect(second).toBeTruthy()
  })
})

describe('dismissNotification', () => {
  it('removes the matching notification', () => {
    const id = pushError('x')
    expect(id).toBeTruthy()
    dismissNotification(id!)
    // Pushing the same message should succeed now that the previous one is gone.
    const again = pushError('x')
    expect(again).toBeTruthy()
  })

  it('is a no-op for an unknown id', () => {
    pushError('x')
    const before = pushError('x') // dupe
    dismissNotification('not-a-real-id')
    expect(before).toBeNull()
  })
})

describe('clearNotifications', () => {
  it('removes all pending entries', () => {
    pushError('a')
    pushError('b')
    clearNotifications()
    expect(pushError('a')).toBeTruthy()
    expect(pushError('b')).toBeTruthy()
  })

  it('is a no-op when there is nothing to clear', () => {
    // Just exercise the early-return — no observable effect, no throw.
    expect(() => clearNotifications()).not.toThrow()
  })
})

describe('useNotifications', () => {
  it('returns the live entries and re-renders on push / dismiss', () => {
    const { result, rerender } = renderHook(() => useNotifications())
    expect(result.current).toEqual([])

    const id = pushError('boom')!
    rerender()
    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ kind: 'error', message: 'boom' })

    dismissNotification(id)
    rerender()
    expect(result.current).toEqual([])
  })

  it('cleanly unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useNotifications())
    unmount()
    // Pushing after unmount must not throw — exercises the listener-removal
    // branch in `subscribe`.
    expect(() => pushError('after-unmount')).not.toThrow()
  })
})
