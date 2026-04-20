import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDriveState, signOut, subscribeDrive } from './drive'

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
