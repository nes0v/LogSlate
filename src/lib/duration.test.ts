import { describe, expect, it } from 'vitest'
import { formatDuration } from './duration'

describe('formatDuration', () => {
  it('renders dash for null and negative', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(-1)).toBe('—')
  })

  it('renders sub-minute as seconds', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(59_499)).toBe('59s')
  })

  it('rolls 60 seconds into 1m', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(59_500)).toBe('1m')
  })

  it('renders sub-hour as Xm or Xm Ys', () => {
    expect(formatDuration(15 * 60_000)).toBe('15m')
    expect(formatDuration(15 * 60_000 + 30_000)).toBe('15m 30s')
    expect(formatDuration(59 * 60_000 + 59_000)).toBe('59m 59s')
  })

  it('renders Xh and Xh Ym at hour boundaries', () => {
    expect(formatDuration(60 * 60_000)).toBe('1h')
    expect(formatDuration(60 * 60_000 + 20 * 60_000)).toBe('1h 20m')
    expect(formatDuration(3 * 60 * 60_000 + 5 * 60_000)).toBe('3h 5m')
  })

  it('rounds milliseconds to nearest second', () => {
    expect(formatDuration(999)).toBe('1s')
    expect(formatDuration(1_499)).toBe('1s')
    expect(formatDuration(1_500)).toBe('2s')
  })
})
