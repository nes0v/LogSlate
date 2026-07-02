import { describe, expect, it } from 'vitest'
import { windowRange } from './use-window-range'
import { tradeRecord } from '@/test/fixtures'

const trades = [
  tradeRecord({ date: '2026-04-14' }),
  tradeRecord({ date: '2026-04-10' }),
  tradeRecord({ date: '2026-04-20' }),
]

describe('windowRange', () => {
  it('returns the explicit bounds when both from and to are set', () => {
    expect(windowRange(trades, '2026-04-01', '2026-04-30')).toEqual({
      rangeStart: '2026-04-01',
      rangeEnd: '2026-04-30',
    })
  })

  it('is null on both ends when there are no trades and no bounds', () => {
    expect(windowRange([], null, null)).toEqual({ rangeStart: null, rangeEnd: null })
  })

  it('spans the filtered trades first..last day when unbounded', () => {
    expect(windowRange(trades, null, null)).toEqual({
      rangeStart: '2026-04-10',
      rangeEnd: '2026-04-20',
    })
  })

  it('honours a lone `from`, taking the last traded day as the end', () => {
    expect(windowRange(trades, '2026-04-12', null)).toEqual({
      rangeStart: '2026-04-12',
      rangeEnd: '2026-04-20',
    })
  })

  it('honours a lone `to`, taking the first traded day as the start', () => {
    expect(windowRange(trades, null, '2026-04-18')).toEqual({
      rangeStart: '2026-04-10',
      rangeEnd: '2026-04-18',
    })
  })
})
