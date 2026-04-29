import { describe, expect, it } from 'vitest'
import {
  classifyTrade,
  computeAhpc,
  computeDuration,
  computeFees,
  computeGrossPnl,
  computeNetPnl,
  computeRealizedRr,
  effectivePnl,
  inferSide,
  isReversal,
  totalContracts,
} from './trade-math'
import { execution, tradeRecord } from '@/test/fixtures'

describe('inferSide', () => {
  it('returns long when first execution is a buy', () => {
    const t = tradeRecord({
      executions: [
        execution({ kind: 'buy', time: '2026-04-15T10:00:00Z' }),
        execution({ kind: 'sell', time: '2026-04-15T10:05:00Z' }),
      ],
    })
    expect(inferSide(t)).toBe('long')
  })

  it('returns short when first execution is a sell', () => {
    const t = tradeRecord({
      executions: [
        execution({ kind: 'sell', time: '2026-04-15T10:00:00Z' }),
        execution({ kind: 'buy', time: '2026-04-15T10:05:00Z' }),
      ],
    })
    expect(inferSide(t)).toBe('short')
  })

  it('returns null when there are no executions', () => {
    expect(inferSide({ executions: [] })).toBeNull()
  })

  it('returns long when only buys exist', () => {
    const t = tradeRecord({ executions: [execution({ kind: 'buy' })] })
    expect(inferSide(t)).toBe('long')
  })

  it('returns short when only sells exist', () => {
    const t = tradeRecord({ executions: [execution({ kind: 'sell' })] })
    expect(inferSide(t)).toBe('short')
  })
})

describe('totalContracts', () => {
  it('returns max of buy/sell totals', () => {
    const t = tradeRecord({
      executions: [
        execution({ kind: 'buy', contracts: 3 }),
        execution({ kind: 'sell', contracts: 2 }),
      ],
    })
    expect(totalContracts(t)).toBe(3)
  })

  it('handles a closed trade with matching sides', () => {
    const t = tradeRecord({
      executions: [
        execution({ kind: 'buy', contracts: 2 }),
        execution({ kind: 'buy', contracts: 1 }),
        execution({ kind: 'sell', contracts: 3 }),
      ],
    })
    expect(totalContracts(t)).toBe(3)
  })
})

describe('computeFees', () => {
  it('micro: $0.62 × total contracts on both sides', () => {
    const t = tradeRecord({
      contract_type: 'micro',
      executions: [
        execution({ kind: 'buy', contracts: 1 }),
        execution({ kind: 'sell', contracts: 1 }),
      ],
    })
    expect(computeFees(t)).toBeCloseTo(1.24, 5)
  })

  it('mini: $2.25 × total contracts on both sides', () => {
    const t = tradeRecord({
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', contracts: 1 }),
        execution({ kind: 'sell', contracts: 1 }),
      ],
    })
    expect(computeFees(t)).toBeCloseTo(4.5, 5)
  })

  it('scales with contract count', () => {
    const t = tradeRecord({
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', contracts: 2 }),
        execution({ kind: 'sell', contracts: 2 }),
      ],
    })
    expect(computeFees(t)).toBeCloseTo(9, 5)
  })
})

describe('computeGrossPnl', () => {
  it('NQ mini: 10 handles × $20 × 1 contract = $200 regardless of side', () => {
    const longTrade = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 20000, contracts: 1 }),
        execution({ kind: 'sell', price: 20010, contracts: 1 }),
      ],
    })
    expect(computeGrossPnl(longTrade)).toBe(200)

    const shortTrade = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'sell', price: 20010, time: '2026-04-15T10:00:00Z', contracts: 1 }),
        execution({ kind: 'buy', price: 20000, time: '2026-04-15T10:05:00Z', contracts: 1 }),
      ],
    })
    expect(computeGrossPnl(shortTrade)).toBe(200)
  })

  it('MNQ micro: 10 handles × $2 × 1 contract = $20', () => {
    const t = tradeRecord({
      symbol: 'NQ',
      contract_type: 'micro',
      executions: [
        execution({ kind: 'buy', price: 20000, contracts: 1 }),
        execution({ kind: 'sell', price: 20010, contracts: 1 }),
      ],
    })
    expect(computeGrossPnl(t)).toBe(20)
  })

  it('ES mini: 4 handles × $50 × 2 contracts = $400', () => {
    const t = tradeRecord({
      symbol: 'ES',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 5000, contracts: 2 }),
        execution({ kind: 'sell', price: 5004, contracts: 2 }),
      ],
    })
    expect(computeGrossPnl(t)).toBe(400)
  })

  it('uses weighted-average entry/exit prices', () => {
    const t = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 20000, contracts: 1 }),
        execution({ kind: 'buy', price: 20020, contracts: 1 }),
        execution({ kind: 'sell', price: 20030, contracts: 2 }),
      ],
    })
    // avgBuy = 20010, avgSell = 20030, 20 handles × $20 × 2 = $800
    expect(computeGrossPnl(t)).toBe(800)
  })

  it('returns null when one side is missing', () => {
    const t = tradeRecord({
      executions: [execution({ kind: 'buy' })],
    })
    expect(computeGrossPnl(t)).toBeNull()
  })
})

describe('computeNetPnl and effectivePnl', () => {
  it('net = gross − fees', () => {
    const t = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 20000, contracts: 1 }),
        execution({ kind: 'sell', price: 20010, contracts: 1 }),
      ],
    })
    expect(computeNetPnl(t)).toBeCloseTo(200 - 4.5, 5)
  })

  it('effectivePnl returns pnl_override when set (even if 0)', () => {
    const t = tradeRecord({ pnl_override: 0 })
    expect(effectivePnl(t)).toBe(0)
  })

  it('effectivePnl falls back to net when override is null', () => {
    const t = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      pnl_override: null,
      executions: [
        execution({ kind: 'buy', price: 20000, contracts: 1 }),
        execution({ kind: 'sell', price: 20010, contracts: 1 }),
      ],
    })
    expect(effectivePnl(t)).toBeCloseTo(195.5, 5)
  })
})

describe('computeAhpc', () => {
  it('returns handles per contract', () => {
    const t = tradeRecord({
      executions: [
        execution({ kind: 'buy', price: 100, contracts: 1 }),
        execution({ kind: 'sell', price: 105, contracts: 1 }),
      ],
    })
    expect(computeAhpc(t)).toBe(5)
  })

  it('is negative for losing trades', () => {
    const t = tradeRecord({
      executions: [
        execution({ kind: 'buy', price: 100, contracts: 1 }),
        execution({ kind: 'sell', price: 95, contracts: 1 }),
      ],
    })
    expect(computeAhpc(t)).toBe(-5)
  })
})

describe('computeRealizedRr', () => {
  it('returns pnl / stop_loss', () => {
    const t = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      stop_loss: 100,
      pnl_override: 250,
      executions: [],
    })
    expect(computeRealizedRr(t)).toBe(2.5)
  })

  it('returns null for zero stop_loss', () => {
    const t = tradeRecord({ stop_loss: 0 })
    expect(computeRealizedRr(t)).toBeNull()
  })

  it('returns null when pnl cannot be computed and no override', () => {
    const t = tradeRecord({ stop_loss: 100, pnl_override: null, executions: [] })
    expect(computeRealizedRr(t)).toBeNull()
  })
})

describe('computeDuration', () => {
  it('returns total and pre-first-exit durations for a long', () => {
    const t = tradeRecord({
      executions: [
        execution({ kind: 'buy', time: '2026-04-15T10:00:00Z' }),
        execution({ kind: 'buy', time: '2026-04-15T10:02:00Z' }),
        execution({ kind: 'sell', time: '2026-04-15T10:05:00Z' }),
        execution({ kind: 'sell', time: '2026-04-15T10:10:00Z' }),
      ],
    })
    const d = computeDuration(t)
    expect(d.total_ms).toBe(10 * 60 * 1000)
    expect(d.before_first_exit_ms).toBe(5 * 60 * 1000)
  })

  it('returns nulls when fewer than 2 executions', () => {
    const t = tradeRecord({ executions: [execution({ kind: 'buy' })] })
    expect(computeDuration(t)).toEqual({ total_ms: null, before_first_exit_ms: null })
  })
})

describe('classifyTrade', () => {
  it('NQ: < 5 handles is breakeven', () => {
    const t = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 20000, contracts: 1 }),
        execution({ kind: 'sell', price: 20004, contracts: 1 }),
      ],
    })
    expect(classifyTrade(t)).toBe('breakeven')
  })

  it('NQ: >= 5 handles is win when positive', () => {
    const t = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 20000, contracts: 1 }),
        execution({ kind: 'sell', price: 20005, contracts: 1 }),
      ],
    })
    expect(classifyTrade(t)).toBe('win')
  })

  it('ES: < 2 handles is breakeven', () => {
    const t = tradeRecord({
      symbol: 'ES',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 5000, contracts: 1 }),
        execution({ kind: 'sell', price: 5001, contracts: 1 }),
      ],
    })
    expect(classifyTrade(t)).toBe('breakeven')
  })

  it('ES: >= 2 handles is win when positive', () => {
    const t = tradeRecord({
      symbol: 'ES',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 5000, contracts: 1 }),
        execution({ kind: 'sell', price: 5002, contracts: 1 }),
      ],
    })
    expect(classifyTrade(t)).toBe('win')
  })
})

describe('isReversal', () => {
  it('detects long → short reversal at the same price/time', () => {
    const flipTime = '2026-04-15T15:00:00.000Z'
    const flipPrice = 20020
    const a = tradeRecord({
      id: 'a',
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 20000, time: '2026-04-15T14:30:00.000Z' }),
        execution({ kind: 'sell', price: flipPrice, time: flipTime }),
      ],
    })
    const b = tradeRecord({
      id: 'b',
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'sell', price: flipPrice, time: flipTime }),
        execution({ kind: 'buy', price: 19990, time: '2026-04-15T15:30:00.000Z' }),
      ],
    })
    expect(isReversal(a, b)).toBe(true)
  })

  it('rejects when sides match (both long)', () => {
    const a = tradeRecord({
      executions: [
        execution({ kind: 'buy', price: 20000, time: '2026-04-15T14:00:00.000Z' }),
        execution({ kind: 'sell', price: 20010, time: '2026-04-15T14:30:00.000Z' }),
      ],
    })
    const b = tradeRecord({
      executions: [
        execution({ kind: 'buy', price: 20010, time: '2026-04-15T14:30:00.000Z' }),
        execution({ kind: 'sell', price: 20020, time: '2026-04-15T15:00:00.000Z' }),
      ],
    })
    expect(isReversal(a, b)).toBe(false)
  })

  it('rejects when prices differ', () => {
    const a = tradeRecord({
      executions: [
        execution({ kind: 'buy', price: 20000, time: '2026-04-15T14:00:00.000Z' }),
        execution({ kind: 'sell', price: 20020, time: '2026-04-15T15:00:00.000Z' }),
      ],
    })
    const b = tradeRecord({
      executions: [
        execution({ kind: 'sell', price: 20021, time: '2026-04-15T15:00:00.000Z' }),
        execution({ kind: 'buy', price: 20010, time: '2026-04-15T15:30:00.000Z' }),
      ],
    })
    expect(isReversal(a, b)).toBe(false)
  })

  it('rejects when times differ', () => {
    const a = tradeRecord({
      executions: [
        execution({ kind: 'buy', price: 20000, time: '2026-04-15T14:00:00.000Z' }),
        execution({ kind: 'sell', price: 20020, time: '2026-04-15T15:00:00.000Z' }),
      ],
    })
    const b = tradeRecord({
      executions: [
        execution({ kind: 'sell', price: 20020, time: '2026-04-15T15:00:01.000Z' }),
        execution({ kind: 'buy', price: 20010, time: '2026-04-15T15:30:00.000Z' }),
      ],
    })
    expect(isReversal(a, b)).toBe(false)
  })

  it('rejects when symbols differ', () => {
    const flipTime = '2026-04-15T15:00:00.000Z'
    const a = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'buy', price: 20000, time: '2026-04-15T14:00:00.000Z' }),
        execution({ kind: 'sell', price: 20020, time: flipTime }),
      ],
    })
    const b = tradeRecord({
      symbol: 'ES',
      contract_type: 'mini',
      executions: [
        execution({ kind: 'sell', price: 20020, time: flipTime }),
        execution({ kind: 'buy', price: 20010, time: '2026-04-15T15:30:00.000Z' }),
      ],
    })
    expect(isReversal(a, b)).toBe(false)
  })
})
