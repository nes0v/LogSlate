import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanOrphanedPendingRefs, db } from '@/db/schema'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import type { PendingUpload } from '@/db/types'
import { tradeRecord } from '@/test/fixtures'

function pending(id: string, overrides: Partial<PendingUpload> = {}): PendingUpload {
  return {
    id,
    account_id: MAIN_ACCOUNT_ID,
    blob: new Blob([], { type: 'image/png' }),
    filename: 'shot.png',
    month_key: '2026-04',
    created_at: '2026-04-15T14:00:00.000Z',
    ...overrides,
  }
}

describe('cleanOrphanedPendingRefs', () => {
  beforeEach(async () => {
    await db.trades.clear()
    await db.days.clear()
    await db.pending_uploads.clear()
  })
  afterEach(async () => {
    await db.trades.clear()
    await db.days.clear()
    await db.pending_uploads.clear()
  })

  it('is a no-op when there are no stale refs', async () => {
    await db.trades.add(tradeRecord({ id: 't1', screenshot: null }))
    await cleanOrphanedPendingRefs()
    const t = await db.trades.get('t1')
    expect(t?.screenshot).toBe(null)
  })

  it('keeps a trade ref that points at a live pending upload', async () => {
    await db.pending_uploads.add(pending('p1'))
    await db.trades.add(tradeRecord({ id: 't1', screenshot: 'pending:p1' }))
    await cleanOrphanedPendingRefs()
    const t = await db.trades.get('t1')
    expect(t?.screenshot).toBe('pending:p1')
  })

  it('clears a trade ref whose pending upload no longer exists', async () => {
    await db.trades.add(tradeRecord({ id: 't1', screenshot: 'pending:gone' }))
    await cleanOrphanedPendingRefs()
    const t = await db.trades.get('t1')
    expect(t?.screenshot).toBe(null)
  })

  it('bumps updated_at on a cleared trade so sync picks up the change', async () => {
    await db.trades.add(
      tradeRecord({
        id: 't1',
        screenshot: 'pending:gone',
        updated_at: '2026-04-15T10:00:00.000Z',
      }),
    )
    await cleanOrphanedPendingRefs()
    const t = await db.trades.get('t1')
    expect(t!.updated_at > '2026-04-15T10:00:00.000Z').toBe(true)
  })

  it('filters dead refs out of a day row that has multiple screenshots', async () => {
    await db.pending_uploads.add(pending('p-live'))
    await db.days.add({
      id: `${MAIN_ACCOUNT_ID}:2026-04-15`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-15',
      screenshots: ['pending:p-live', 'pending:p-gone', 'drive:abc'],
      created_at: '2026-04-15T14:00:00.000Z',
      updated_at: '2026-04-15T14:00:00.000Z',
    })
    await cleanOrphanedPendingRefs()
    const d = await db.days.get(`${MAIN_ACCOUNT_ID}:2026-04-15`)
    expect(d?.screenshots).toEqual(['pending:p-live', 'drive:abc'])
  })

  it('deletes a day row that loses its only screenshot to cleanup', async () => {
    await db.days.add({
      id: `${MAIN_ACCOUNT_ID}:2026-04-15`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-15',
      screenshots: ['pending:gone'],
      created_at: '2026-04-15T14:00:00.000Z',
      updated_at: '2026-04-15T14:00:00.000Z',
    })
    await cleanOrphanedPendingRefs()
    const d = await db.days.get(`${MAIN_ACCOUNT_ID}:2026-04-15`)
    expect(d).toBeUndefined()
  })

  it('handles a trade and a day with overlapping pending refs in one pass', async () => {
    await db.pending_uploads.add(pending('p-live'))
    await db.trades.add(tradeRecord({ id: 't1', screenshot: 'pending:p-gone' }))
    await db.trades.add(tradeRecord({ id: 't2', screenshot: 'pending:p-live' }))
    await db.days.add({
      id: `${MAIN_ACCOUNT_ID}:2026-04-15`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-15',
      screenshots: ['pending:p-gone', 'pending:p-live'],
      created_at: '2026-04-15T14:00:00.000Z',
      updated_at: '2026-04-15T14:00:00.000Z',
    })
    await cleanOrphanedPendingRefs()
    expect((await db.trades.get('t1'))?.screenshot).toBe(null)
    expect((await db.trades.get('t2'))?.screenshot).toBe('pending:p-live')
    const d = await db.days.get(`${MAIN_ACCOUNT_ID}:2026-04-15`)
    expect(d?.screenshots).toEqual(['pending:p-live'])
  })
})
