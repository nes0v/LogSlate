import { describe, expect, it } from 'vitest'
import { formatUsd } from './money'

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

  it('rounds to 2 decimals', () => {
    expect(formatUsd(1.005)).toBe('$1.01')
    expect(formatUsd(1.004)).toBe('$1.00')
  })
})
