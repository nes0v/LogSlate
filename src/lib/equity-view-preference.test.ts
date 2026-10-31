import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { setDefaultEquityView, useDefaultEquityView } from './equity-view-preference'
import { setActiveAccountId } from './active-account'
import { MAIN_ACCOUNT_ID } from '@/db/types'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

// What the hook reads for `accountId` right now.
function viewFor(accountId: string) {
  setActiveAccountId(accountId)
  const { result, unmount } = renderHook(() => useDefaultEquityView())
  const view = result.current
  unmount()
  setActiveAccountId(MAIN_ACCOUNT_ID)
  return view
}

describe('equity view preference', () => {
  it('returns the default ("candles") when nothing is stored', () => {
    expect(viewFor('acct-1')).toBe('candles')
  })

  it('round-trips through localStorage scoped per account', () => {
    setDefaultEquityView('curve', 'acct-1')
    expect(viewFor('acct-1')).toBe('curve')
    expect(viewFor('acct-2')).toBe('candles') // independent
  })

  it('falls back to default when stored value is unrecognized', () => {
    localStorage.setItem('logslate:equity_view_default:acct-1', 'garbage')
    expect(viewFor('acct-1')).toBe('candles')
  })

  it('survives localStorage read failures', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('quota')
      })
    expect(viewFor('acct-1')).toBe('candles')
    spy.mockRestore()
  })

  it('survives localStorage write failures without throwing', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota')
      })
    expect(() => setDefaultEquityView('curve', 'acct-1')).not.toThrow()
    spy.mockRestore()
  })

  it('skips the listener notify when the value did not actually change', () => {
    setDefaultEquityView('curve', 'acct-1')
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem')
    setDefaultEquityView('curve', 'acct-1') // same value
    expect(writeSpy).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })

  it('defaults the account arg to the currently active account', () => {
    setActiveAccountId('acct-1')
    setDefaultEquityView('curve')
    // Reset back so it doesn't leak into other suites.
    setActiveAccountId(MAIN_ACCOUNT_ID)
    expect(viewFor('acct-1')).toBe('curve')
  })
})

describe('useDefaultEquityView', () => {
  it('returns the current value and re-renders when it changes', () => {
    setActiveAccountId('acct-1')
    const { result, rerender } = renderHook(() => useDefaultEquityView())
    expect(result.current).toBe('candles')
    setDefaultEquityView('curve', 'acct-1')
    rerender()
    expect(result.current).toBe('curve')
    setActiveAccountId(MAIN_ACCOUNT_ID)
  })

  it('stops rendering after unmount', () => {
    setActiveAccountId('acct-2')
    let renders = 0
    const { unmount } = renderHook(() => {
      renders++
      return useDefaultEquityView()
    })
    unmount()
    const before = renders
    act(() => setDefaultEquityView('curve', 'acct-2'))
    expect(renders).toBe(before)
    setActiveAccountId(MAIN_ACCOUNT_ID)
  })

  it('still applies a choice when localStorage throws', () => {
    setActiveAccountId('acct-3')
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result, rerender } = renderHook(() => useDefaultEquityView())
    expect(result.current).toBe('candles')
    act(() => setDefaultEquityView('curve', 'acct-3'))
    rerender()
    expect(result.current).toBe('curve')
    get.mockRestore()
    set.mockRestore()
    setActiveAccountId(MAIN_ACCOUNT_ID)
  })
})
