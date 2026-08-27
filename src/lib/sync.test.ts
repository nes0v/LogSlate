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
  fetchDriveUser,
  findAppDataFile,
  uploadAppDataFile,
} from './drive'
import { adjustmentRecord, tradeRecord } from '@/test/fixtures'

vi.mock('./drive', () => ({
  findAppDataFile: vi.fn(),
  downloadAppDataFile: vi.fn(),
  uploadAppDataFile: vi.fn(),
  fetchDriveUser: vi.fn(),
}))

const findFile = vi.mocked(findAppDataFile)
const downloadFile = vi.mocked(downloadAppDataFile)
const uploadFile = vi.mocked(uploadAppDataFile)
const fetchUser = vi.mocked(fetchDriveUser)

const STUB_USER = { permissionId: 'user-1', emailAddress: 'a@example.com' }

function accountRecord(overrides: Partial<Account> = {}): Account {
  const now = '2026-04-20T00:00:00Z'
  return {
    id: 'alpha',
    name: 'Alpha',
    is_main: false,
    starting_balance: 0,
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
    const local = [tradeRecord({ id: 'a', notes: 'local', updated_at: '2026-04-15T12:00:00Z' })]
    const remote = [tradeRecord({ id: 'a', notes: 'remote', updated_at: '2026-04-15T14:00:00Z' })]
    const merged = mergeById(local, remote, new Set())
    expect(merged[0].notes).toBe('remote')
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
    fetchUser.mockReset()
    fetchUser.mockResolvedValue(STUB_USER)
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
    await db.trades.add(tradeRecord({ id: 't1', notes: 'first' }))
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
      tradeRecord({ id: 't1', notes: 'local-only', updated_at: '2026-04-15T10:00:00Z' }),
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
        tradeRecord({ id: 't2', notes: 'remote-only', updated_at: '2026-04-15T11:00:00Z' }),
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
    const trade = tradeRecord({ id: 't1', notes: 'in-sync', updated_at: '2026-04-15T10:00:00Z' })
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

  it('throws DriveFileCorruptError when remote JSON is unparseable and confirmation is missing', async () => {
    await db.trades.add(tradeRecord({ id: 't1', notes: 'survives' }))
    findFile.mockResolvedValue({
      id: 'fid',
      name: 'logslate.json',
      modifiedTime: '2026-04-15T11:00:00Z',
    })
    downloadFile.mockResolvedValue('not json {{{')

    const { DriveFileCorruptError } = await import('./sync')
    await expect(syncNow()).rejects.toBeInstanceOf(DriveFileCorruptError)
    // Guard fires before any clear/bulkAdd, before any upload.
    expect(uploadFile).not.toHaveBeenCalled()
    expect(await db.trades.count()).toBe(1)
  })

  it('throws DriveFileVersionError when remote file declares a newer version', async () => {
    // A future device wrote a v99 file. The current client doesn't
    // understand it — merging would silently drop unknown fields and
    // the next push would overwrite the newer client's work. Hard-block
    // until this device is updated.
    await db.trades.add(tradeRecord({ id: 't1' }))
    findFile.mockResolvedValue({
      id: 'fid',
      name: 'logslate.json',
      modifiedTime: '2026-04-15T11:00:00Z',
    })
    downloadFile.mockResolvedValue(
      JSON.stringify({ version: 99, exported_at: '2099-01-01', trades: [] }),
    )

    const { DriveFileVersionError } = await import('./sync')
    await expect(syncNow()).rejects.toBeInstanceOf(DriveFileVersionError)
    // Guard fires before any clear/bulkAdd or upload.
    expect(uploadFile).not.toHaveBeenCalled()
    expect(await db.trades.count()).toBe(1)
  })

  it('overwriteCorruptRemote: replaces unparseable remote with local data', async () => {
    await db.trades.add(tradeRecord({ id: 't1', notes: 'survives' }))
    findFile.mockResolvedValue({
      id: 'fid',
      name: 'logslate.json',
      modifiedTime: '2026-04-15T11:00:00Z',
    })
    downloadFile.mockResolvedValue('not json {{{')
    uploadFile.mockResolvedValue(uploaded('fid'))

    const result = await syncNow({ overwriteCorruptRemote: true })

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
        'symbols',
        'trades',
      ].sort(),
    )
    expect(result.perTable.adjustments.merged).toBe(1)
  })

  it('drops a local row that was in last-synced but is missing from remote (deleted-remotely)', async () => {
    // Seed lastSyncedIds so the merge interprets the local-only record as
    // "deleted remotely" instead of "new locally".
    localStorage.setItem('logslate:sync:trade_ids', JSON.stringify(['ghost']))
    await db.trades.add(tradeRecord({ id: 'ghost', notes: 'should be tombstoned' }))
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
    await db.trades.add(tradeRecord({ id: 't1', notes: 'queued for push' }))
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

  it('saves lastSyncedIds before the push so a deletion after a failed push does not resurrect on retry', async () => {
    // Scenario: remote has r1, local has both r1 and a new l1 that needs
    // pushing. Sync 1 merges to {r1, l1} and tries to push — push fails.
    // The user then deletes r1 locally. On Sync 2 (remote unchanged) r1
    // must NOT come back — and it won't, because lastSyncedIds was
    // saved before the upload attempt, so the merge sees r1 as
    // "in lastSynced + in remote + not in local" → tombstone.
    await db.trades.add(tradeRecord({ id: 'l1', notes: 'local-only' }))
    findFile.mockResolvedValue({
      id: 'fid',
      name: 'logslate.json',
      modifiedTime: '2026-04-15T11:00:00Z',
    })
    downloadFile.mockResolvedValue(
      JSON.stringify({
        version: 6,
        exported_at: '2026-04-15T11:00:00Z',
        trades: [tradeRecord({ id: 'r1', notes: 'remote-only' })],
      }),
    )
    uploadFile.mockRejectedValueOnce(new Error('network down'))

    await expect(syncNow()).rejects.toThrow(/network down/)

    // Push failed but the merge already ran: local now has both rows.
    // lastSyncedIds was stamped with the CONSERVATIVE set (only r1 —
    // the one we know is on Drive), excluding l1 because l1's push
    // failed and Drive doesn't have it.
    expect((await db.trades.toArray()).map(t => t.id).sort()).toEqual(['l1', 'r1'])
    expect(
      JSON.parse(localStorage.getItem('logslate:sync:trade_ids') ?? '[]'),
    ).toEqual(['r1'])

    // User deletes the freshly-merged-in remote row.
    await db.trades.delete('r1')

    // Retry sync: remote still only has r1, upload succeeds this time.
    uploadFile.mockResolvedValue(uploaded('fid'))
    const result = await syncNow()

    // r1 stays gone (in lastSynced + in remote + not in local → drop).
    // l1 survives (not in lastSynced + only in local → keep + push).
    expect((await db.trades.toArray()).map(t => t.id)).toEqual(['l1'])
    expect(result.perTable.trades.merged).toBe(1)
  })

  it('does not silently drop a locally-created row when its first push fails', async () => {
    // Scenario: user creates l1 locally, syncs (no remote yet) → push
    // fails. With the OLD post-push save, lastSyncedIds stayed empty
    // and l1 survived. With a naive pre-push save of the merged set,
    // l1 would have been added to lastSyncedIds, and a deletion-then-
    // resync would have resurrected it from… nothing. With the
    // conservative pre-push save, l1 is NOT added to lastSyncedIds
    // until the push actually succeeds, so it cannot be silently
    // tombstoned by a future merge.
    await db.trades.add(tradeRecord({ id: 'l1', notes: 'first ever' }))
    findFile.mockResolvedValue(null)
    uploadFile.mockRejectedValueOnce(new Error('network down'))

    await expect(syncNow()).rejects.toThrow(/network down/)

    // l1 untouched locally; lastSyncedIds is empty (l1 not yet on Drive).
    expect(await db.trades.count()).toBe(1)
    expect(localStorage.getItem('logslate:sync:trade_ids')).toEqual('[]')

    // Retry succeeds.
    uploadFile.mockResolvedValue(uploaded())
    await syncNow()

    // l1 still there, AND now in lastSyncedIds (post-push save ran).
    expect(await db.trades.count()).toBe(1)
    expect(
      JSON.parse(localStorage.getItem('logslate:sync:trade_ids') ?? '[]'),
    ).toEqual(['l1'])
  })

  it('stamps the Drive user permissionId after a successful push', async () => {
    await db.trades.add(tradeRecord({ id: 't1' }))
    findFile.mockResolvedValue(null)
    uploadFile.mockResolvedValue(uploaded())

    await syncNow()

    expect(localStorage.getItem('logslate:sync:drive_user')).toBe(STUB_USER.permissionId)
  })

  it('throws DriveAccountMismatchError when the signed-in user differs from the stored fingerprint', async () => {
    // Prior sync stamped a different user.
    localStorage.setItem('logslate:sync:drive_user', 'previous-user')
    await db.trades.add(tradeRecord({ id: 't1' }))
    findFile.mockResolvedValue(null)
    uploadFile.mockResolvedValue(uploaded())

    const { DriveAccountMismatchError } = await import('./sync')
    await expect(syncNow()).rejects.toBeInstanceOf(DriveAccountMismatchError)
    // No data touched: no upload, lastSyncedIds untouched (still empty).
    expect(uploadFile).not.toHaveBeenCalled()
    expect(localStorage.getItem('logslate:sync:trade_ids')).toBeNull()
    // Local row is still there — the guard fires before any merge/clear.
    expect(await db.trades.count()).toBe(1)
  })

  it('throws DriveFileGoneError when the file is missing but lastSyncedIds shows prior sync', async () => {
    // Seed lastSyncedIds as if a previous sync had pushed t1 + t2.
    localStorage.setItem('logslate:sync:trade_ids', JSON.stringify(['t1', 't2']))
    await db.trades.add(tradeRecord({ id: 't1' }))
    await db.trades.add(tradeRecord({ id: 't2' }))
    findFile.mockResolvedValue(null) // file gone

    const { DriveFileGoneError } = await import('./sync')
    await expect(syncNow()).rejects.toBeInstanceOf(DriveFileGoneError)
    expect(uploadFile).not.toHaveBeenCalled()
    // Local rows untouched — the guard fires before clear/bulkAdd.
    expect(await db.trades.count()).toBe(2)
  })

  it('does NOT throw DriveFileGoneError on a first-ever sync (lastSyncedIds empty + no remote)', async () => {
    await db.trades.add(tradeRecord({ id: 't1' }))
    findFile.mockResolvedValue(null)
    uploadFile.mockResolvedValue(uploaded())

    await expect(syncNow()).resolves.toBeDefined()
  })

  it('recreateRemoteIfMissing: keeps local rows and pushes a fresh file', async () => {
    // Same setup as the file-gone test, but the user has confirmed
    // recreate. Merge must keep all local rows (treat lastSyncedIds as
    // empty for this run) instead of tombstoning them.
    localStorage.setItem('logslate:sync:trade_ids', JSON.stringify(['t1', 't2']))
    await db.trades.add(tradeRecord({ id: 't1' }))
    await db.trades.add(tradeRecord({ id: 't2' }))
    findFile.mockResolvedValue(null)
    uploadFile.mockResolvedValue(uploaded())

    const result = await syncNow({ recreateRemoteIfMissing: true })

    expect(result.createdRemote).toBe(true)
    expect(result.perTable.trades).toEqual({ local: 2, remote: 0, merged: 2 })
    expect(await db.trades.count()).toBe(2)
    // lastSyncedIds re-stamped with the pushed ids.
    const ids = JSON.parse(
      localStorage.getItem('logslate:sync:trade_ids') ?? '[]',
    ) as string[]
    expect(ids.sort()).toEqual(['t1', 't2'])
  })
})
