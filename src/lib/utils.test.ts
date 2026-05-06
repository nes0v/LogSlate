import { describe, it, expect } from 'vitest'
import { errorMessage } from './utils'

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
