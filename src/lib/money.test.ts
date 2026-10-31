import { describe, expect, it } from 'vitest'
import { formatUsd, roundTo } from './money'

describe('formatUsd', () => {
  it('formats positive with $ and 2 decimals', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50')
  })

  it('formats zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })

  it('formats negative with leading minus', () => {
    expect(formatUsd(-42)).toBe('-$42.00')
  })

  it('drops the sign of float dust that rounds to zero', () => {
    expect(formatUsd(10.1 + 20.2 - 30.3)).toBe('$0.00')
  })

  it('roundTo rounds half away from zero and folds -0', () => {
    expect(roundTo(1.005)).toBe(1.01)
    expect(roundTo(-1.005)).toBe(-1.01)
    expect(formatUsd(roundTo(-1.005))).toBe(formatUsd(-1.005))
    expect(Object.is(roundTo(-0.001), 0)).toBe(true)
    expect(roundTo(-2.5, 0)).toBe(-3)
  })

  it('rounds to 2 decimals', () => {
    expect(formatUsd(1.005)).toBe('$1.01')
    expect(formatUsd(1.004)).toBe('$1.00')
  })
})
