import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultEquityView, setDefaultEquityView } from './equity-view-preference'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('equity view preference', () => {
  it('returns the default ("curve") when nothing is stored', () => {
    expect(getDefaultEquityView('acct-1')).toBe('curve')
  })

  it('round-trips through localStorage scoped per account', () => {
    setDefaultEquityView('candles', 'acct-1')
    expect(getDefaultEquityView('acct-1')).toBe('candles')
    expect(getDefaultEquityView('acct-2')).toBe('curve') // independent
  })

  it('falls back to default when stored value is unrecognized', () => {
    localStorage.setItem('logslate:equity_view_default:acct-1', 'garbage')
    expect(getDefaultEquityView('acct-1')).toBe('curve')
  })

  it('survives localStorage read failures', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('quota')
      })
    expect(getDefaultEquityView('acct-1')).toBe('curve')
    spy.mockRestore()
  })

  it('survives localStorage write failures without throwing', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota')
      })
    expect(() => setDefaultEquityView('candles', 'acct-1')).not.toThrow()
    spy.mockRestore()
  })

  it('skips the listener notify when the value did not actually change', () => {
    setDefaultEquityView('candles', 'acct-1')
    const writeSpy = vi.spyOn(Storage.prototype, 'setItem')
    setDefaultEquityView('candles', 'acct-1') // same value
    expect(writeSpy).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })
})
