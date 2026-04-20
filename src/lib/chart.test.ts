import { describe, expect, it } from 'vitest'
import { niceDomain } from './chart'

describe('niceDomain', () => {
  it('rounds a [0, 511.6] range up to [0, 600]', () => {
    expect(niceDomain(0, 511.6)).toEqual([0, 600])
  })

  it('rounds to a 5-step when range fits a 5-step nicely', () => {
    // span=45, mag=10, norm=4.5 → step=5 → [0, 45]
    expect(niceDomain(0, 45)).toEqual([0, 45])
  })

  it('handles negative min with symmetric step', () => {
    const [lo, hi] = niceDomain(-120, 340)
    expect(lo).toBeLessThanOrEqual(-120)
    expect(hi).toBeGreaterThanOrEqual(340)
    // step should be a "nice" power of 10 × 1, 2, or 5
    const span = hi - lo
    expect(span % 100).toBe(0)
  })

  it('adds padding when min === max', () => {
    const [lo, hi] = niceDomain(50, 50)
    expect(lo).toBeLessThan(50)
    expect(hi).toBeGreaterThan(50)
  })

  it('adds padding when min === max === 0', () => {
    const [lo, hi] = niceDomain(0, 0)
    expect(lo).toBeLessThan(0)
    expect(hi).toBeGreaterThan(0)
  })

  it('falls back to [0,1] for non-finite input', () => {
    expect(niceDomain(NaN, 10)).toEqual([0, 1])
    expect(niceDomain(0, Infinity)).toEqual([0, 1])
  })
})
