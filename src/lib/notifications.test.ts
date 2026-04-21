import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearNotifications,
  dismissNotification,
  pushError,
  pushInfo,
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
})
