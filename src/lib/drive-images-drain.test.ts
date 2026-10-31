import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = { find: 0 }
const uploadMock = vi.fn<(o: { name: string; parentId?: string }) => Promise<{ id: string }>>()
const deleteMock = vi.fn<(id: string) => Promise<void>>()

vi.mock('./drive', async () => {
  const actual = await vi.importActual<typeof import('./drive')>('./drive')
  return {
    ...actual,
    getDriveState: () => ({ status: 'signed-in' }),
    findDriveFolder: async (name: string) => {
      calls.find++
      return `folder-${name}`
    },
    createDriveFolder: async (name: string) => `new-${name}`,
    driveFileExists: async () => true,
    uploadDriveFile: (o: { name: string; parentId?: string }) => uploadMock(o),
    deleteDriveFile: (id: string) => deleteMock(id),
  }
})

const { db } = await import('@/db/schema')
const { drainPendingUploads } = await import('./drive-images')
const { addPendingDayScreenshot, removeDayScreenshot } = await import('@/db/queries')
const { importBackup } = await import('./backup')

function pending(id: string) {
  return {
    id,
    account_id: 'main',
    blob: new Blob(['x'], { type: 'image/png' }),
    filename: 'f.png',
    month_key: '2026-10',
    created_at: '2026-10-01T00:00:00Z',
  }
}

describe('drainPendingUploads', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    localStorage.clear()
    uploadMock.mockReset()
    deleteMock.mockReset().mockResolvedValue()
    calls.find = 0
  })

  it('re-finds the folders after a failed upload instead of reusing a dead one', async () => {
    await addPendingDayScreenshot('main', '2026-10-01', pending('p1'))
    uploadMock.mockResolvedValueOnce({ id: 'd1' })
    await drainPendingUploads()
    const findsAfterFirst = calls.find

    // The month folder was deleted in Drive: the first try fails, the retry
    // re-resolves the folders and succeeds.
    await addPendingDayScreenshot('main', '2026-10-02', pending('p2'))
    uploadMock.mockRejectedValueOnce(new Error('Drive upload failed: 404')).mockResolvedValueOnce({ id: 'd2' })
    await drainPendingUploads()

    expect(calls.find).toBeGreaterThan(findsAfterFirst)
    expect(await db.pending_uploads.count()).toBe(0)
  })

  it('deletes the uploaded file when its screenshot was removed mid-upload', async () => {
    await addPendingDayScreenshot('main', '2026-10-01', pending('p1'))
    let release!: () => void
    uploadMock.mockImplementation(
      () => new Promise(r => (release = () => r({ id: 'orphan' }))),
    )
    const run = drainPendingUploads()
    await vi.waitFor(() => expect(uploadMock).toHaveBeenCalled())
    await removeDayScreenshot('main', '2026-10-01', 'pending:p1')
    release()
    await run
    expect(deleteMock).toHaveBeenCalledWith('orphan')
  })
})

describe('importBackup', () => {
  it('drops queued uploads no restored day points at', async () => {
    await db.delete()
    await db.open()
    await addPendingDayScreenshot('main', '2026-10-01', pending('p1'))
    const empty = Object.fromEntries(
      ['trades', 'adjustments', 'accounts', 'days', 'models', 'symbols', 'progress_rules', 'progress_checks', 'news'].map(
        k => [k, []],
      ),
    )
    await importBackup(new File([JSON.stringify({ version: 9, exported_at: 'x', ...empty })], 'b.json'))
    expect(await db.pending_uploads.count()).toBe(0)
  })
})
