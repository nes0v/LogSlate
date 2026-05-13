import { describe, it, expect } from 'vitest'
import { cn, entries, errorMessage, mergeRefs } from './utils'

describe('errorMessage', () => {
  it('extracts message from Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('extracts message from Error subclasses', () => {
    class CustomError extends Error {}
    expect(errorMessage(new CustomError('custom'))).toBe('custom')
  })

  it('returns string values verbatim', () => {
    expect(errorMessage('plain message')).toBe('plain message')
  })

  it("doesn't crash on null", () => {
    expect(errorMessage(null)).toBe('null')
  })

  it("doesn't crash on undefined", () => {
    expect(errorMessage(undefined)).toBe('undefined')
  })

  it('coerces non-Error objects via String()', () => {
    expect(errorMessage({ status: 500 })).toBe('[object Object]')
  })

  it('falls back to the Error name when message is empty', () => {
    class DriveScopeError extends Error {
      override name = 'DriveScopeError'
    }
    expect(errorMessage(new DriveScopeError())).toBe('DriveScopeError')
  })

  it("falls back to 'Error' on a generic Error with empty message", () => {
    expect(errorMessage(new Error(''))).toBe('Error')
  })

  it("falls back to 'Error' on an empty string", () => {
    expect(errorMessage('')).toBe('Error')
  })
})

describe('cn', () => {
  it('joins simple class strings', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('skips falsy entries and accepts arrays + objects', () => {
    expect(cn('a', null, undefined, false && 'b', ['c', 'd'], { e: true, f: false })).toBe(
      'a c d e',
    )
  })

  it('de-conflicts Tailwind utilities via tailwind-merge (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-(--color-text-dim)', 'text-(--color-text)')).toContain(
      'text-(--color-text)',
    )
  })
})

describe('entries', () => {
  it('returns key-value tuples preserving the narrow key type at runtime', () => {
    const map = { a: 1, b: 2 } as const
    expect(entries(map)).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('returns an empty array for an empty record', () => {
    expect(entries({} as Record<string, number>)).toEqual([])
  })
})

describe('mergeRefs', () => {
  it('forwards the value to every callback ref in order', () => {
    const calls: Array<[number, unknown]> = []
    const ref1 = (v: unknown): void => {
      calls.push([1, v])
    }
    const ref2 = (v: unknown): void => {
      calls.push([2, v])
    }
    mergeRefs<string>(ref1, ref2)('hello')
    expect(calls).toEqual([
      [1, 'hello'],
      [2, 'hello'],
    ])
  })

  it('writes the value to every MutableRefObject', () => {
    const ref1: { current: string | null } = { current: null }
    const ref2: { current: string | null } = { current: null }
    mergeRefs<string>(ref1, ref2)('hello')
    expect(ref1.current).toBe('hello')
    expect(ref2.current).toBe('hello')
  })

  it('skips null and undefined entries without throwing', () => {
    const ref: { current: string | null } = { current: null }
    mergeRefs<string>(null, undefined, ref)('hello')
    expect(ref.current).toBe('hello')
  })

  it('propagates a null value (for unmount/detach)', () => {
    const ref: { current: string | null } = { current: 'previous' }
    mergeRefs<string>(ref)(null)
    expect(ref.current).toBe(null)
  })
})
