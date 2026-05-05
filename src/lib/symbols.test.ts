import { describe, expect, it } from 'vitest'
import { feePerSide, handleValue, FEE_PER_SIDE_BY_CONTRACT, HANDLE_VALUE } from './symbols'

describe('handleValue', () => {
  it('returns CME spec values per symbol × contract', () => {
    expect(handleValue('NQ', 'mini')).toBe(20)
    expect(handleValue('NQ', 'micro')).toBe(2)
    expect(handleValue('ES', 'mini')).toBe(50)
    expect(handleValue('ES', 'micro')).toBe(5)
  })

  it('table covers every (symbol, contract) cell', () => {
    expect(Object.keys(HANDLE_VALUE).sort()).toEqual(['ES', 'NQ'])
    for (const sym of Object.keys(HANDLE_VALUE) as Array<keyof typeof HANDLE_VALUE>) {
      expect(Object.keys(HANDLE_VALUE[sym]).sort()).toEqual(['micro', 'mini'])
    }
  })
})

describe('feePerSide', () => {
  it('returns broker fee per side by contract type', () => {
    expect(feePerSide('micro')).toBe(0.62)
    expect(feePerSide('mini')).toBe(2.25)
  })

  it('table has both contract types', () => {
    expect(Object.keys(FEE_PER_SIDE_BY_CONTRACT).sort()).toEqual(['micro', 'mini'])
  })
})
