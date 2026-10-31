import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { signedIn: false }
const deleteMock = vi.fn<(id: string) => Promise<void>>()

vi.mock('./drive', async () => {
  const actual = await vi.importActual<typeof import('./drive')>('./drive')
  return {
    ...actual,
    getDriveState: () => ({ status: state.signedIn ? 'signed-in' : 'signed-out' }),
    deleteDriveFile: (id: string) => deleteMock(id),
  }
})

const { discardScreenshotRef, drainPendingDeletes } = await import('./drive-images')

describe('Drive deletes that fail', () => {
  beforeEach(() => {
    localStorage.clear()
    deleteMock.mockReset()
    state.signedIn = false
  })

  it('are retried on the next drain once signed in', async () => {
    deleteMock.mockRejectedValueOnce(new Error('Not connected'))
    await discardScreenshotRef('drive:file-1')

    state.signedIn = true
    deleteMock.mockResolvedValue()
    await drainPendingDeletes()
    expect(deleteMock).toHaveBeenLastCalledWith('file-1')

    // Done: a second drain has nothing left to delete.
    deleteMock.mockClear()
    await drainPendingDeletes()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('are not retried when Drive refuses for good', async () => {
    deleteMock.mockRejectedValue(new Error('Drive delete failed: 400'))
    await discardScreenshotRef('drive:file-3')
    state.signedIn = true
    deleteMock.mockClear()
    await drainPendingDeletes()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('stay queued while the retry keeps failing', async () => {
    deleteMock.mockRejectedValue(new Error('offline'))
    await discardScreenshotRef('drive:file-2')
    state.signedIn = true
    await drainPendingDeletes()

    deleteMock.mockReset()
    deleteMock.mockResolvedValue()
    await drainPendingDeletes()
    expect(deleteMock).toHaveBeenCalledWith('file-2')
  })
})
