import { describe, expect, it } from 'vitest'
import { SESSIONS } from '@/db/types'
import { SESSION_BG, SESSION_FG } from './session-colors'

describe('session colors', () => {
  it('SESSION_BG defines a swatch for every session', () => {
    expect(Object.keys(SESSION_BG).sort()).toEqual([...SESSIONS].sort())
  })

  it('SESSION_FG defines a foreground for every session', () => {
    expect(Object.keys(SESSION_FG).sort()).toEqual([...SESSIONS].sort())
  })

  it('every value is a 6-digit hex literal', () => {
    const hex = /^#[0-9a-f]{6}$/i
    for (const s of SESSIONS) {
      expect(SESSION_BG[s]).toMatch(hex)
      expect(SESSION_FG[s]).toMatch(hex)
    }
  })
})
