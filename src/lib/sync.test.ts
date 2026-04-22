import { describe, expect, it } from 'vitest'
import type { Account } from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import { mergeById } from './sync'
import { adjustmentRecord, tradeRecord } from '@/test/fixtures'

function accountRecord(overrides: Partial<Account> = {}): Account {
  const now = '2026-04-20T00:00:00Z'
  return {
    id: 'alpha',
    name: 'Alpha',
    is_main: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

describe('mergeById — trades', () => {
  it('unions disjoint local + remote', () => {
    const local = [tradeRecord({ id: 'a' })]
    const remote = [tradeRecord({ id: 'b' })]
    const merged = mergeById(local, remote, new Set())
    expect(merged.map(t => t.id).sort()).toEqual(['a', 'b'])
  })

  it('prefers the newer updated_at when both sides have the same id', () => {
    const local = [tradeRecord({ id: 'a', idea: 'local', updated_at: '2026-04-15T12:00:00Z' })]
    const remote = [tradeRecord({ id: 'a', idea: 'remote', updated_at: '2026-04-15T14:00:00Z' })]
    const merged = mergeById(local, remote, new Set())
    expect(merged[0].idea).toBe('remote')
  })

  it('drops a local-only record that was in last-synced (remote deleted it)', () => {
    const local = [tradeRecord({ id: 'a' })]
    const remote: typeof local = []
    const merged = mergeById(local, remote, new Set(['a']))
    expect(merged).toHaveLength(0)
  })

  it('drops a remote-only record that was in last-synced (local deleted it)', () => {
    const local: ReturnType<typeof tradeRecord>[] = []
    const remote = [tradeRecord({ id: 'a' })]
    const merged = mergeById(local, remote, new Set(['a']))
    expect(merged).toHaveLength(0)
  })

  it('keeps a new-on-local record that is not in last-synced', () => {
    const local = [tradeRecord({ id: 'new' })]
    const merged = mergeById(local, [], new Set())
    expect(merged.map(t => t.id)).toEqual(['new'])
  })

  it('keeps a new-on-remote record that is not in last-synced', () => {
    const remote = [tradeRecord({ id: 'new' })]
    const merged = mergeById([], remote, new Set())
    expect(merged.map(t => t.id)).toEqual(['new'])
  })
})

describe('mergeById — adjustments', () => {
  it('uses the same last-write-wins + tombstone strategy', () => {
    const local = [
      adjustmentRecord({ id: 'keep', updated_at: '2026-04-15T10:00:00Z' }),
      adjustmentRecord({ id: 'deleted-remotely', updated_at: '2026-04-15T10:00:00Z' }),
    ]
    const remote = [
      adjustmentRecord({ id: 'keep', amount: 2000, updated_at: '2026-04-15T14:00:00Z' }),
    ]
    const merged = mergeById(local, remote, new Set(['keep', 'deleted-remotely']))
    expect(merged.map(a => a.id)).toEqual(['keep'])
    expect(merged[0].amount).toBe(2000)
  })
})

describe('mergeById — accounts', () => {
  it('unions disjoint accounts from both sides', () => {
    const local = [accountRecord({ id: MAIN_ACCOUNT_ID, name: 'Main', is_main: true })]
    const remote = [accountRecord({ id: 'funded', name: 'Funded' })]
    const merged = mergeById(local, remote, new Set())
    expect(merged.map(a => a.id).sort()).toEqual(['funded', MAIN_ACCOUNT_ID].sort())
  })

  it('prefers the newer side when names diverge (rename)', () => {
    const local = [accountRecord({ id: 'alpha', name: 'Alpha', updated_at: '2026-04-20T10:00:00Z' })]
    const remote = [accountRecord({ id: 'alpha', name: 'Beta', updated_at: '2026-04-20T14:00:00Z' })]
    const merged = mergeById(local, remote, new Set())
    expect(merged[0].name).toBe('Beta')
  })

  it('drops a local-only account that was in last-synced (deleted remotely)', () => {
    const local = [accountRecord({ id: 'funded' })]
    const merged = mergeById(local, [], new Set(['funded']))
    expect(merged).toHaveLength(0)
  })

  it('keeps a new-on-local account that is not in last-synced', () => {
    const local = [accountRecord({ id: 'newlyadded' })]
    const merged = mergeById(local, [], new Set())
    expect(merged.map(a => a.id)).toEqual(['newlyadded'])
  })
})
