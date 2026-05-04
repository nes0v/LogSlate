import { describe, expect, it } from 'vitest'
import {
  classifyTrade,
  computeAhpc,
  computeDuration,
  computeFees,
  computeGrossPnl,
  computeNetPnl,
  computePlannedRr,
  computeRealizedRr,
  firstExecutionMs,
  inferSide,
  isReversal,
  lastExecutionMs,
  outcomeTextClass,
  totalContracts,
  tradeMetrics,
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

describe('computeNetPnl', () => {
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
    // Net pnl = 200 − 4.5 fees = 195.5; stop_loss 100 → 1.955.
    const t = tradeRecord({
      symbol: 'NQ',
      contract_type: 'mini',
      stop_loss: 100,
      executions: [
        execution({ kind: 'buy', price: 20000, contracts: 1 }),
        execution({ kind: 'sell', price: 20010, contracts: 1 }),
      ],
    })
    expect(computeRealizedRr(t)).toBeCloseTo(1.955, 5)
  })

  it('returns null for zero stop_loss', () => {
    const t = tradeRecord({ stop_loss: 0 })
    expect(computeRealizedRr(t)).toBeNull()
  })

  it('returns null when pnl cannot be computed', () => {
    const t = tradeRecord({ stop_loss: 100, executions: [] })
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

  it('measures pre-first-exit on a short from the first buy (cover)', () => {
    const t = tradeRecord({
      executions: [
        execution({ kind: 'sell', time: '2026-04-15T10:00:00Z' }),
        execution({ kind: 'sell', time: '2026-04-15T10:01:00Z' }),
        execution({ kind: 'buy', time: '2026-04-15T10:04:00Z' }),
        execution({ kind: 'buy', time: '2026-04-15T10:08:00Z' }),
      ],
    })
    const d = computeDuration(t)
    expect(d.total_ms).toBe(8 * 60 * 1000)
    expect(d.before_first_exit_ms).toBe(4 * 60 * 1000)
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

describe("tradeMetrics", () => {
  it("returns ahpc, pnl, and outcome from a single pass", () => {
    const t = tradeRecord({
      symbol: "NQ",
      contract_type: "mini",
      executions: [
        execution({ kind: "buy", price: 20000, contracts: 1 }),
        execution({ kind: "sell", price: 20010, contracts: 1 }),
      ],
    })
    const m = tradeMetrics(t)
    expect(m.ahpc).toBe(10)
    expect(m.pnl).toBeCloseTo(195.5, 5)
    expect(m.outcome).toBe("win")
  })

  it("classifies sub-threshold AHPC as breakeven even when pnl is positive", () => {
    // NQ threshold is 5 handles; 3 handles × $20 − fees = +$55.50 net.
    // The handle band still wins → 'breakeven'.
    const t = tradeRecord({
      symbol: "NQ",
      contract_type: "mini",
      executions: [
        execution({ kind: "buy", price: 20000, contracts: 1 }),
        execution({ kind: "sell", price: 20003, contracts: 1 }),
      ],
    })
    const m = tradeMetrics(t)
    expect(m.outcome).toBe("breakeven")
    expect(m.pnl).toBeGreaterThan(0)
    expect(Math.abs(m.ahpc!)).toBeLessThan(5)
  })

  it("returns null pnl + null ahpc when executions are empty", () => {
    const t = tradeRecord({ executions: [] })
    const m = tradeMetrics(t)
    expect(m.ahpc).toBeNull()
    expect(m.pnl).toBeNull()
    expect(m.outcome).toBe("breakeven")
  })
})

describe("firstExecutionMs", () => {
  it("returns the earliest execution time in epoch ms", () => {
    const t = tradeRecord({
      executions: [
        execution({ time: "2026-04-15T15:00:00.000Z" }),
        execution({ time: "2026-04-15T13:00:00.000Z" }),
        execution({ time: "2026-04-15T14:00:00.000Z" }),
      ],
    })
    expect(firstExecutionMs(t)).toBe(Date.parse("2026-04-15T13:00:00.000Z"))
  })

  it("returns null when there are no valid times", () => {
    expect(firstExecutionMs({ executions: [] })).toBeNull()
  })
})

describe("lastExecutionMs", () => {
  it("returns the latest execution time in epoch ms", () => {
    const t = tradeRecord({
      executions: [
        execution({ time: "2026-04-15T13:00:00.000Z" }),
        execution({ time: "2026-04-15T15:00:00.000Z" }),
        execution({ time: "2026-04-15T14:00:00.000Z" }),
      ],
    })
    expect(lastExecutionMs(t)).toBe(Date.parse("2026-04-15T15:00:00.000Z"))
  })

  it("returns null when there are no valid times", () => {
    expect(lastExecutionMs({ executions: [] })).toBeNull()
  })
})

describe("computePlannedRr", () => {
  it("returns profit_target / stop_loss when both > 0", () => {
    const t = tradeRecord({ stop_loss: 100, profit_target: 200 })
    expect(computePlannedRr(t)).toBe(2)
  })

  it("returns null when stop_loss is 0", () => {
    const t = tradeRecord({ stop_loss: 0, profit_target: 200 })
    expect(computePlannedRr(t)).toBeNull()
  })

  it("returns 0 for a zero profit_target (no upside / scratch target)", () => {
    expect(computePlannedRr(tradeRecord({ stop_loss: 100, profit_target: 0 }))).toBe(0)
  })
})

describe('outcomeTextClass', () => {
  it('dims the row when there is no PnL value yet', () => {
    expect(outcomeTextClass('win', false)).toMatch(/text-dim/)
    expect(outcomeTextClass('loss', false)).toMatch(/text-dim/)
    expect(outcomeTextClass('breakeven', false)).toMatch(/text-dim/)
  })
  it('maps win → win color and loss → loss color', () => {
    expect(outcomeTextClass('win', true)).toMatch(/--color-win/)
    expect(outcomeTextClass('loss', true)).toMatch(/--color-loss/)
  })
  it('uses the neutral text color for breakeven', () => {
    expect(outcomeTextClass('breakeven', true)).toMatch(/--color-text\)/)
  })
})
