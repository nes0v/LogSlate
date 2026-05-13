import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadJsonFromStorage,
  removeFromStorage,
  saveJsonToStorage,
} from './storage'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function isStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every(x => typeof x === 'string')
    ? (v as string[])
    : null
}

describe('loadJsonFromStorage', () => {
  it('returns the fallback when the key is missing', () => {
    expect(loadJsonFromStorage('k', isStringArray, [])).toEqual([])
  })

  it('returns the validated value on a clean read', () => {
    localStorage.setItem('k', JSON.stringify(['a', 'b']))
    expect(loadJsonFromStorage('k', isStringArray, [])).toEqual(['a', 'b'])
  })

  it('returns the fallback when JSON.parse throws on corrupt input', () => {
    localStorage.setItem('k', 'not json')
    expect(loadJsonFromStorage('k', isStringArray, ['fallback'])).toEqual([
      'fallback',
    ])
  })

  it('returns the fallback when the validator rejects the shape', () => {
    localStorage.setItem('k', JSON.stringify({ unexpected: true }))
    expect(loadJsonFromStorage('k', isStringArray, [])).toEqual([])
  })

  it('returns the fallback when localStorage.getItem itself throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(loadJsonFromStorage('k', isStringArray, ['fallback'])).toEqual([
      'fallback',
    ])
  })
})

describe('saveJsonToStorage', () => {
  it('round-trips through loadJsonFromStorage', () => {
    saveJsonToStorage('k', ['x', 'y'])
    expect(loadJsonFromStorage('k', isStringArray, [])).toEqual(['x', 'y'])
  })

  it('survives setItem failures without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveJsonToStorage('k', ['x'])).not.toThrow()
  })
})

describe('removeFromStorage', () => {
  it('removes the entry so the next load returns the fallback', () => {
    saveJsonToStorage('k', ['x'])
    removeFromStorage('k')
    expect(loadJsonFromStorage('k', isStringArray, ['fallback'])).toEqual([
      'fallback',
    ])
  })

  it('survives removeItem failures without throwing', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => removeFromStorage('k')).not.toThrow()
  })
})
