import { describe, expect, it } from 'vitest'
import { mergeAdjustments, mergeTrades } from './sync'
import { adjustmentRecord, tradeRecord } from '@/test/fixtures'

describe('mergeTrades', () => {
  it('unions disjoint local + remote', () => {
    const local = [tradeRecord({ id: 'a' })]
    const remote = [tradeRecord({ id: 'b' })]
    const merged = mergeTrades(local, remote, new Set())
    expect(merged.map(t => t.id).sort()).toEqual(['a', 'b'])
  })

  it('prefers the newer updated_at when both sides have the same id', () => {
    const local = [tradeRecord({ id: 'a', idea: 'local', updated_at: '2026-04-15T12:00:00Z' })]
    const remote = [tradeRecord({ id: 'a', idea: 'remote', updated_at: '2026-04-15T14:00:00Z' })]
    const merged = mergeTrades(local, remote, new Set())
    expect(merged[0].idea).toBe('remote')
  })

  it('drops a local-only record that was in last-synced (remote deleted it)', () => {
    const local = [tradeRecord({ id: 'a' })]
    const remote: typeof local = []
    const merged = mergeTrades(local, remote, new Set(['a']))
    expect(merged).toHaveLength(0)
  })

  it('drops a remote-only record that was in last-synced (local deleted it)', () => {
    const local: ReturnType<typeof tradeRecord>[] = []
    const remote = [tradeRecord({ id: 'a' })]
    const merged = mergeTrades(local, remote, new Set(['a']))
    expect(merged).toHaveLength(0)
  })

  it('keeps a new-on-local record that is not in last-synced', () => {
    const local = [tradeRecord({ id: 'new' })]
    const merged = mergeTrades(local, [], new Set())
    expect(merged.map(t => t.id)).toEqual(['new'])
  })

  it('keeps a new-on-remote record that is not in last-synced', () => {
    const remote = [tradeRecord({ id: 'new' })]
    const merged = mergeTrades([], remote, new Set())
    expect(merged.map(t => t.id)).toEqual(['new'])
  })
})

describe('mergeAdjustments', () => {
  it('uses the same last-write-wins + tombstone strategy', () => {
    const local = [
      adjustmentRecord({ id: 'keep', updated_at: '2026-04-15T10:00:00Z' }),
      adjustmentRecord({ id: 'deleted-remotely', updated_at: '2026-04-15T10:00:00Z' }),
    ]
    const remote = [
      adjustmentRecord({ id: 'keep', amount: 2000, updated_at: '2026-04-15T14:00:00Z' }),
    ]
    const merged = mergeAdjustments(local, remote, new Set(['keep', 'deleted-remotely']))
    expect(merged.map(a => a.id)).toEqual(['keep'])
    expect(merged[0].amount).toBe(2000)
  })
})
