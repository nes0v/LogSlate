import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDriveState, parseExpiresIn, signOut, subscribeDrive } from './drive'

beforeEach(() => {
  localStorage.clear()
  // Reset the module-level state by simulating a fresh sign-out tick.
  signOut()
})

afterEach(() => {
  localStorage.clear()
})

describe('drive external store', () => {
  it('emits a *new* state reference on update so React re-renders', () => {
    const before = getDriveState()
    const listener = vi.fn()
    const unsub = subscribeDrive(listener)

    // Seed a stored token so signOut has something to clear, then sign out again
    // to force an update() call.
    localStorage.setItem(
      'logslate:drive:token',
      JSON.stringify({ value: 'x', expiresAt: Date.now() + 60_000 }),
    )
    signOut()

    expect(listener).toHaveBeenCalled()
    const after = getDriveState()
    expect(after).not.toBe(before) // reference changed — this was the bug we fixed
    expect(after.status).toBe('signed-out')

    unsub()
  })

  it('subscribers can unsubscribe', () => {
    const listener = vi.fn()
    const unsub = subscribeDrive(listener)
    unsub()
    signOut()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('parseExpiresIn', () => {
  it('accepts a well-formed number within range', () => {
    expect(parseExpiresIn(3600)).toBe(3600)
    expect(parseExpiresIn(1800)).toBe(1800)
  })

  it('accepts a numeric string', () => {
    expect(parseExpiresIn('3599')).toBe(3599)
  })

  it('defaults to 3600 on missing / malformed values', () => {
    expect(parseExpiresIn(undefined)).toBe(3600)
    expect(parseExpiresIn(null)).toBe(3600)
    expect(parseExpiresIn('abc')).toBe(3600)
    expect(parseExpiresIn(NaN)).toBe(3600)
  })

  it('defaults to 3600 on zero or negative — never produces an instantly-expired token', () => {
    expect(parseExpiresIn(0)).toBe(3600)
    expect(parseExpiresIn(-10)).toBe(3600)
    expect(parseExpiresIn('-5')).toBe(3600)
  })

  it('clamps to the minimum window so refresh loops cannot happen', () => {
    expect(parseExpiresIn(1)).toBe(60)
    expect(parseExpiresIn(30)).toBe(60)
  })

  it('clamps absurd values to one day', () => {
    expect(parseExpiresIn(9_999_999)).toBe(86_400)
  })
})
