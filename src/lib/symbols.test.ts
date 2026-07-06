import { describe, expect, it } from 'vitest'
import { SYMBOL_PRESETS } from './symbols'

describe('SYMBOL_PRESETS', () => {
  it('carries CME point values per symbol × contract', () => {
    expect(SYMBOL_PRESETS.NQ.mini.point_value).toBe(20)
    expect(SYMBOL_PRESETS.NQ.micro.point_value).toBe(2)
    expect(SYMBOL_PRESETS.ES.mini.point_value).toBe(50)
    expect(SYMBOL_PRESETS.ES.micro.point_value).toBe(5)
    expect(SYMBOL_PRESETS.YM.mini.point_value).toBe(5)
    expect(SYMBOL_PRESETS.YM.micro.point_value).toBe(0.5)
  })

  it('names micro contracts with an M prefix', () => {
    expect(SYMBOL_PRESETS.NQ.micro.name).toBe('MNQ')
    expect(SYMBOL_PRESETS.ES.micro.name).toBe('MES')
    expect(SYMBOL_PRESETS.YM.micro.name).toBe('MYM')
  })

  it('applies broker fee by contract size (mini 2.25, micro 0.62)', () => {
    expect(SYMBOL_PRESETS.NQ.mini.fee_per_side).toBe(2.25)
    expect(SYMBOL_PRESETS.NQ.micro.fee_per_side).toBe(0.62)
    expect(SYMBOL_PRESETS.ES.micro.fee_per_side).toBe(0.62)
  })

  it('covers every (symbol, contract) cell', () => {
    expect(Object.keys(SYMBOL_PRESETS).sort()).toEqual(['ES', 'NQ', 'YM'])
    for (const sym of Object.keys(SYMBOL_PRESETS) as Array<keyof typeof SYMBOL_PRESETS>) {
      expect(Object.keys(SYMBOL_PRESETS[sym]).sort()).toEqual(['micro', 'mini'])
    }
  })
})
