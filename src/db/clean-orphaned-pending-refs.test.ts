import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanOrphanedPendingRefs, db } from '@/db/schema'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import type { PendingUpload } from '@/db/types'

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
    await db.days.clear()
    await db.pending_uploads.clear()
  })
  afterEach(async () => {
    await db.days.clear()
    await db.pending_uploads.clear()
  })

  it('is a no-op when there are no stale refs', async () => {
    await db.pending_uploads.add(pending('p1'))
    await db.days.add({
      id: `${MAIN_ACCOUNT_ID}:2026-04-15`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-15',
      screenshots: ['pending:p1'],
      created_at: '2026-04-15T14:00:00.000Z',
      updated_at: '2026-04-15T14:00:00.000Z',
    })
    await cleanOrphanedPendingRefs()
    const d = await db.days.get(`${MAIN_ACCOUNT_ID}:2026-04-15`)
    expect(d?.screenshots).toEqual(['pending:p1'])
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

  it('preserves a day row whose only screenshot is orphaned but has a note', async () => {
    // Regression: previously the orphan-cleanup deleted the whole day
    // row when screenshots became empty, wiping the user's journal note
    // for that day. Notes are independent of screenshots.
    await db.days.add({
      id: `${MAIN_ACCOUNT_ID}:2026-04-15`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-15',
      screenshots: ['pending:gone'],
      note: 'reviewed the morning session: stayed out of the chop',
      created_at: '2026-04-15T14:00:00.000Z',
      updated_at: '2026-04-15T14:00:00.000Z',
    })
    await cleanOrphanedPendingRefs()
    const d = await db.days.get(`${MAIN_ACCOUNT_ID}:2026-04-15`)
    expect(d).toBeDefined()
    expect(d?.screenshots).toEqual([])
    expect(d?.note).toBe('reviewed the morning session: stayed out of the chop')
  })
})
