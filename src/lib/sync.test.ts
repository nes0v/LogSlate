import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import { db } from '@/db/schema'
import {
  clearSyncState,
  lastSyncAt,
  mergeById,
  syncNow,
  type SyncResult,
} from './sync'
import {
  downloadAppDataFile,
  findAppDataFile,
  uploadAppDataFile,
} from './drive'
import { adjustmentRecord, tradeRecord } from '@/test/fixtures'

vi.mock('./drive', () => ({
  findAppDataFile: vi.fn(),
  downloadAppDataFile: vi.fn(),
  uploadAppDataFile: vi.fn(),
}))

const findFile = vi.mocked(findAppDataFile)
const downloadFile = vi.mocked(downloadAppDataFile)
const uploadFile = vi.mocked(uploadAppDataFile)

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

describe('lastSyncAt', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing has been synced', () => {
    expect(lastSyncAt()).toBeNull()
  })

  it('parses a stored ISO timestamp', () => {
    localStorage.setItem('logslate:sync:at', '2026-04-15T12:00:00.000Z')
    const at = lastSyncAt()
    expect(at).not.toBeNull()
    expect(at!.toISOString()).toBe('2026-04-15T12:00:00.000Z')
  })

  it('returns null on a stored value that does not parse', () => {
    localStorage.setItem('logslate:sync:at', 'not-a-date')
    expect(lastSyncAt()).toBeNull()
  })
})

describe('clearSyncState', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('removes the at-timestamp and every per-table id set', () => {
    localStorage.setItem('logslate:sync:at', '2026-04-15T12:00:00.000Z')
    localStorage.setItem('logslate:sync:trade_ids', JSON.stringify(['a', 'b']))
    localStorage.setItem('logslate:sync:model_ids', JSON.stringify(['m1']))
    clearSyncState()
    expect(localStorage.getItem('logslate:sync:at')).toBeNull()
    expect(localStorage.getItem('logslate:sync:trade_ids')).toBeNull()
    expect(localStorage.getItem('logslate:sync:model_ids')).toBeNull()
  })
})

describe('syncNow', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.trades.clear()
    await db.adjustments.clear()
    await db.accounts.clear()
    await db.days.clear()
    await db.models.clear()
    await db.progress_rules.clear()
    await db.progress_checks.clear()
    await db.news.clear()
    findFile.mockReset()
    downloadFile.mockReset()
    uploadFile.mockReset()
  })
  afterEach(async () => {
    localStorage.clear()
    await db.trades.clear()
    await db.adjustments.clear()
    await db.accounts.clear()
    await db.days.clear()
    await db.models.clear()
    await db.progress_rules.clear()
    await db.progress_checks.clear()
    await db.news.clear()
  })

  function uploaded(id = 'remote-file-id'): ReturnType<typeof uploadFile> extends Promise<infer R> ? R : never {
    // Match DriveFileMeta minus the inferred-promise wrapper.
    return { id, name: 'logslate.json', modifiedTime: '2026-04-15T12:00:00.000Z' } as never
  }

  it('uploads a fresh file when no remote exists', async () => {
    await db.trades.add(tradeRecord({ id: 't1', idea: 'first' }))
    findFile.mockResolvedValue(null)
    uploadFile.mockResolvedValue(uploaded())

    const result: SyncResult = await syncNow()

    expect(downloadFile).not.toHaveBeenCalled()
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(result.createdRemote).toBe(true)
    expect(result.skippedPush).toBe(false)
    expect(result.perTable.trades).toEqual({ local: 1, remote: 0, merged: 1 })
    // lastSyncAt + last-synced ids persisted.
    expect(lastSyncAt()).not.toBeNull()
    const storedIds = JSON.parse(
      localStorage.getItem('logslate:sync:trade_ids') ?? '[]',
    ) as string[]
    expect(storedIds).toEqual(['t1'])
  })

  it('downloads, merges, and uploads when remote exists with diverged data', async () => {
    await db.trades.add(
      tradeRecord({ id: 't1', idea: 'local-only', updated_at: '2026-04-15T10:00:00Z' }),
    )
    findFile.mockResolvedValue({
      id: 'fid',
      name: 'logslate.json',
      modifiedTime: '2026-04-15T11:00:00Z',
    })
    const remoteFile = {
      version: 6,
      exported_at: '2026-04-15T11:00:00Z',
      trades: [
        tradeRecord({ id: 't2', idea: 'remote-only', updated_at: '2026-04-15T11:00:00Z' }),
      ],
    }
    downloadFile.mockResolvedValue(JSON.stringify(remoteFile))
    uploadFile.mockResolvedValue(uploaded('fid'))

    const result = await syncNow()

    expect(downloadFile).toHaveBeenCalledWith('fid')
    expect(result.skippedPush).toBe(false)
    expect(result.perTable.trades).toEqual({ local: 1, remote: 1, merged: 2 })
    // Local DB now contains both rows after the merge transaction.
    const stored = await db.trades.toArray()
    expect(stored.map(t => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('skips push when remote already matches the merged set', async () => {
    const trade = tradeRecord({ id: 't1', idea: 'in-sync', updated_at: '2026-04-15T10:00:00Z' })
    await db.trades.add(trade)
    findFile.mockResolvedValue({
      id: 'fid',
      name: 'logslate.json',
      modifiedTime: '2026-04-15T11:00:00Z',
    })
    downloadFile.mockResolvedValue(
      JSON.stringify({
        version: 6,
        exported_at: '2026-04-15T11:00:00Z',
        trades: [trade],
      }),
    )

    const result = await syncNow()

    expect(uploadFile).not.toHaveBeenCalled()
    expect(result.skippedPush).toBe(true)
    expect(result.createdRemote).toBe(false)
    expect(result.fileId).toBe('fid')
  })

  it('treats corrupt remote JSON as empty and re-uploads', async () => {
    await db.trades.add(tradeRecord({ id: 't1', idea: 'survives' }))
    findFile.mockResolvedValue({
      id: 'fid',
      name: 'logslate.json',
      modifiedTime: '2026-04-15T11:00:00Z',
    })
    downloadFile.mockResolvedValue('not json {{{')
    uploadFile.mockResolvedValue(uploaded('fid'))

    const result = await syncNow()

    expect(result.skippedPush).toBe(false)
    expect(result.perTable.trades.remote).toBe(0)
    expect(result.perTable.trades.merged).toBe(1)
    const stored = await db.trades.toArray()
    expect(stored).toHaveLength(1)
  })

  it('reports per-table counts for every spec', async () => {
    await db.trades.add(tradeRecord({ id: 't1' }))
    await db.adjustments.add(adjustmentRecord({ id: 'a1' }))
    findFile.mockResolvedValue(null)
    uploadFile.mockResolvedValue(uploaded())

    const result = await syncNow()

    expect(Object.keys(result.perTable).sort()).toEqual(
      [
        'accounts',
        'adjustments',
        'days',
        'models',
        'news',
        'progress_checks',
        'progress_rules',
        'trades',
      ].sort(),
    )
    expect(result.perTable.adjustments.merged).toBe(1)
  })

  it('drops a local row that was in last-synced but is missing from remote (deleted-remotely)', async () => {
    // Seed lastSyncedIds so the merge interprets the local-only record as
    // "deleted remotely" instead of "new locally".
    localStorage.setItem('logslate:sync:trade_ids', JSON.stringify(['ghost']))
    await db.trades.add(tradeRecord({ id: 'ghost', idea: 'should be tombstoned' }))
    findFile.mockResolvedValue({
      id: 'fid',
      name: 'logslate.json',
      modifiedTime: '2026-04-15T11:00:00Z',
    })
    downloadFile.mockResolvedValue(
      JSON.stringify({ version: 6, exported_at: '2026-04-15T11:00:00Z', trades: [] }),
    )
    uploadFile.mockResolvedValue(uploaded('fid'))

    const result = await syncNow()

    expect(result.perTable.trades.merged).toBe(0)
    expect(await db.trades.toArray()).toHaveLength(0)
  })

  it('aborts the push when Drive modifiedTime advances between pull and push', async () => {
    // Local has a new row that needs pushing.
    await db.trades.add(tradeRecord({ id: 't1', idea: 'queued for push' }))
    // findFile is called twice during a sync that pushes:
    //   1. initial pull metadata
    //   2. stale-write recheck right before upload
    // Return a different modifiedTime on the second call to simulate
    // another device pushing in the gap.
    findFile
      .mockResolvedValueOnce({
        id: 'fid',
        name: 'logslate.json',
        modifiedTime: '2026-04-15T11:00:00Z',
      })
      .mockResolvedValueOnce({
        id: 'fid',
        name: 'logslate.json',
        modifiedTime: '2026-04-15T11:05:00Z',
      })
    downloadFile.mockResolvedValue(
      JSON.stringify({ version: 6, exported_at: '2026-04-15T11:00:00Z', trades: [] }),
    )

    await expect(syncNow()).rejects.toThrow(/Drive file changed during sync/)
    expect(uploadFile).not.toHaveBeenCalled()
    // lastSyncedIds were NOT updated — next sync re-merges with the
    // fresh remote and pushes the union.
    expect(localStorage.getItem('logslate:sync:trade_ids')).toBeNull()
  })
})
