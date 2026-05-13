import { describe, expect, it } from 'vitest'
import { computeOrphanRules } from './model-rules'

describe('computeOrphanRules', () => {
  it('returns empty when followed is empty', () => {
    expect(
      computeOrphanRules([{ rules: ['a', 'b'] }], []),
    ).toEqual([])
  })

  it('returns empty when groups have no rules', () => {
    expect(
      computeOrphanRules([], ['a', 'b']),
    ).toEqual(['a', 'b'])
  })

  it('returns strings in followed not present in any group', () => {
    const groups = [
      { rules: ['entry-confirmation', 'liquidity-sweep'] },
      { rules: ['stop-at-swing-low'] },
    ]
    const followed = ['liquidity-sweep', 'old-rule', 'another-old-rule']
    expect(computeOrphanRules(groups, followed)).toEqual([
      'old-rule',
      'another-old-rule',
    ])
  })

  it('preserves the iteration order of followed', () => {
    const groups: { rules: string[] }[] = []
    expect(computeOrphanRules(groups, ['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })

  it('treats duplicates in groups as a single membership check', () => {
    const groups = [{ rules: ['a', 'a'] }, { rules: ['a'] }]
    expect(computeOrphanRules(groups, ['a', 'b'])).toEqual(['b'])
  })

  it('accepts a Set as followed', () => {
    const groups = [{ rules: ['a'] }]
    expect(computeOrphanRules(groups, new Set(['a', 'b', 'c']))).toEqual([
      'b',
      'c',
    ])
  })

  it('matches by exact string (trailing whitespace counts as different)', () => {
    const groups = [{ rules: ['rule'] }]
    expect(computeOrphanRules(groups, ['rule', 'rule '])).toEqual(['rule '])
  })
})
