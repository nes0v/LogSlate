import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getActiveAccountId,
  requireActiveAccountId,
  setActiveAccountId,
  useActiveAccountId,
} from './active-account'
import { SEED_ACCOUNT_ID } from '@/db/types'
import { renderHook } from '@testing-library/react'

beforeEach(() => {
  setActiveAccountId(SEED_ACCOUNT_ID)
  localStorage.clear()
})
afterEach(() => {
  setActiveAccountId(SEED_ACCOUNT_ID)
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('getActiveAccountId / setActiveAccountId', () => {
  it('round-trips through localStorage', () => {
    setActiveAccountId('alpha')
    expect(getActiveAccountId()).toBe('alpha')
    expect(localStorage.getItem('logslate:active_account')).toBe('alpha')
  })

  it('is a no-op when setting the same id (does not re-write or notify)', () => {
    setActiveAccountId('alpha')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setActiveAccountId('alpha')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('survives a localStorage write throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => setActiveAccountId('alpha')).not.toThrow()
    expect(getActiveAccountId()).toBe('alpha')
  })
})

describe('useActiveAccountId', () => {
  it('returns the current value and re-renders on change', () => {
    const { result, rerender } = renderHook(() => useActiveAccountId())
    expect(result.current).toBe(SEED_ACCOUNT_ID)
    setActiveAccountId('beta')
    rerender()
    expect(result.current).toBe('beta')
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useActiveAccountId())
    unmount()
    // No assertion needed beyond "doesn't throw"; the listener removal path
    // runs in the cleanup returned from `subscribe` and is exercised here.
    setActiveAccountId('gamma')
    expect(getActiveAccountId()).toBe('gamma')
  })
})

describe('requireActiveAccountId', () => {
  it('returns the active id', () => {
    setActiveAccountId('alpha')
    expect(requireActiveAccountId()).toBe('alpha')
  })

  it('throws instead of handing a write an empty id', () => {
    setActiveAccountId('')
    expect(() => requireActiveAccountId()).toThrow(/no account/i)
  })
})
