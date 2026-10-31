import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
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
    const { result } = renderHook(() => useNotifications())
    let id: string | null = null
    act(() => {
      id = pushError('boom')
    })
    expect(id).toBeTruthy()
    expect(result.current).toEqual([{ id, kind: 'error', message: 'boom', action: undefined }])
  })

  it('de-dupes repeat errors with the same message', () => {
    const first = pushError('boom')
    const second = pushError('boom')
    expect(first).toBeTruthy()
    expect(second).toBeNull()
  })

  it('stores the action with the entry', () => {
    const { result } = renderHook(() => useNotifications())
    const action = { label: 'Settings', to: '/settings' }
    act(() => {
      pushError('reconnect needed', action)
    })
    expect(result.current[0].action).toEqual(action)
  })

  it('does NOT de-dupe two errors with the same message but different actions', () => {
    const first = pushError('reconnect needed', { label: 'Settings', to: '/settings' })
    const second = pushError('reconnect needed', { label: 'Help', to: '/help' })
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
  })

  it('de-dupes two errors with the same message and matching action', () => {
    const first = pushError('reconnect needed', { label: 'Settings', to: '/settings' })
    const second = pushError('reconnect needed', { label: 'Settings', to: '/settings' })
    expect(first).toBeTruthy()
    expect(second).toBeNull()
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
    dismissNotification('not-a-real-id')
    // 'x' is still there, so a repeat is still de-duped.
    expect(pushError('x')).toBeNull()
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

  it('does not notify subscribers when there is nothing to clear', () => {
    let renders = 0
    renderHook(() => {
      renders++
      return useNotifications()
    })
    const before = renders
    act(() => clearNotifications())
    expect(renders).toBe(before)
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

  it('stops rendering after unmount', () => {
    let renders = 0
    const { unmount } = renderHook(() => {
      renders++
      return useNotifications()
    })
    unmount()
    const before = renders
    act(() => {
      pushError('after-unmount')
    })
    expect(renders).toBe(before)
  })
})
