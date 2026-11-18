import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  clearDefaultRangeWeeks,
  setDefaultRangeWeeks,
  useDefaultRangeWeeks,
} from './default-range-preference'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

function weeksFor(accountId: string): number {
  const { result, unmount } = renderHook(() => useDefaultRangeWeeks(accountId))
  const weeks = result.current
  unmount()
  return weeks
}

describe('default range preference', () => {
  it('defaults to 4 weeks', () => {
    expect(weeksFor('a')).toBe(4)
  })

  it('keeps each account its own choice', () => {
    setDefaultRangeWeeks('a', 7)
    setDefaultRangeWeeks('b', 11)
    expect(weeksFor('a')).toBe(7)
    expect(weeksFor('b')).toBe(11)
  })

  it('reads the old app-wide months setting as 4 weeks per month', () => {
    localStorage.setItem('logslate:default_range_months', '3')
    expect(weeksFor('a')).toBe(12)
    setDefaultRangeWeeks('a', 5)
    expect(weeksFor('a')).toBe(5)
    expect(weeksFor('b')).toBe(12)
  })

  it('ignores out-of-range or junk values', () => {
    setDefaultRangeWeeks('a', 17)
    expect(weeksFor('a')).toBe(4)
    localStorage.setItem('logslate:default_range_weeks:a', 'x')
    expect(weeksFor('a')).toBe(4)
  })

  it('re-renders a mounted reader on set and on clear', () => {
    const { result, unmount } = renderHook(() => useDefaultRangeWeeks('a'))
    expect(result.current).toBe(4)
    act(() => setDefaultRangeWeeks('a', 10))
    expect(result.current).toBe(10)
    act(() => clearDefaultRangeWeeks('a'))
    expect(result.current).toBe(4)
    unmount()
  })

  it('ignores a stored number outside 4–16', () => {
    localStorage.setItem('logslate:default_range_weeks:a', '17')
    expect(weeksFor('a')).toBe(4)
  })

  it('clear forgets the account choice', () => {
    setDefaultRangeWeeks('a', 9)
    clearDefaultRangeWeeks('a')
    expect(weeksFor('a')).toBe(4)
  })
})
