// Covers the manual sync entry point: drain ordering, success/error
// routing, the single-flight lock, surfaced state transitions, and the
// state-clear helper used on Drive sign-out.
//
// Module-level state in auto-sync.ts (singleton `isSyncing`) means each
// test needs a fresh module instance — done via `vi.resetModules()` +
// dynamic import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveScopeError } from './drive'

const syncNowMock = vi.fn<(opts?: unknown) => Promise<unknown>>()
const drainMock = vi.fn<() => Promise<void>>()
const pushErrorMock = vi.fn<(message: string, action?: unknown) => string>(() => 'notif-id')

// Pin the './drive' module identity. Without this mock, vi.resetModules()
// in beforeEach causes auto-sync's fresh import of DriveScopeError to be
// a different class instance than the one the test file imported at top
// — breaking the `instanceof DriveScopeError` check inside runSync().
vi.mock('./drive', async () => {
  const actual = await vi.importActual<typeof import('./drive')>('./drive')
  return { ...actual }
})

vi.mock('./drive-images', () => ({
  drainPendingUploads: () => drainMock(),
}))

vi.mock('./sync', async () => {
  // Re-export the real error classes (auto-sync.ts narrows on
  // `instanceof` to pick the right error kind), but stub `syncNow`.
  const actual = await vi.importActual<typeof import('./sync')>('./sync')
  return {
    ...actual,
    syncNow: (opts?: unknown) => syncNowMock(opts),
  }
})

vi.mock('./notifications', () => ({
  pushError: (message: string, action?: unknown) => pushErrorMock(message, action),
}))

beforeEach(() => {
  vi.resetModules()
  syncNowMock.mockReset()
  drainMock.mockReset()
  pushErrorMock.mockReset().mockReturnValue('notif-id')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function loadModule(): Promise<typeof import('./auto-sync')> {
  return import('./auto-sync')
}

// Tiny helper: schedule a `syncNow` mock that pauses until the returned
// `release` is called. Captures the resolver in a Promise so callers can
// `await waitForCall` to be sure the mock has actually been invoked
// before trying to release it.
function pausableSync(): {
  waitForCall: Promise<void>
  release: () => void
} {
  let release = () => {}
  let signalCalled = () => {}
  const waitForCall = new Promise<void>(r => {
    signalCalled = r
  })
  syncNowMock.mockImplementation(
    () =>
      new Promise(resolve => {
        release = () => resolve(fakeResult)
        signalCalled()
      }),
  )
  return {
    waitForCall,
    release: () => release(),
  }
}

const fakeResult = {
  perTable: {},
  createdRemote: false,
  skippedPush: false,
  fileId: 'f',
  modifiedTime: '2026-04-20T00:00:00Z',
  mergedAt: '2026-04-20T00:00:00Z',
}

describe('requestManualSync', () => {
  it('drains pending uploads before pushing the sync file', async () => {
    const order: string[] = []
    drainMock.mockImplementation(async () => {
      order.push('drain')
    })
    syncNowMock.mockImplementation(async () => {
      order.push('sync')
      return fakeResult
    })
    const { requestManualSync } = await loadModule()
    await requestManualSync()
    expect(order).toEqual(['drain', 'sync'])
  })

  it('returns the sync result on success', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { requestManualSync } = await loadModule()
    expect(await requestManualSync()).toBe(fakeResult)
  })

  it('returns null and routes DriveScopeError to a "Reconnect" notification', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockRejectedValue(new DriveScopeError('expired'))
    const { requestManualSync } = await loadModule()
    expect(await requestManualSync()).toBeNull()
    expect(pushErrorMock).toHaveBeenCalledWith('expired', {
      label: 'Reconnect',
      to: '/settings',
    })
  })

  it('returns null and routes generic errors to a "Settings" notification', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockRejectedValue(new Error('network down'))
    const { requestManualSync } = await loadModule()
    expect(await requestManualSync()).toBeNull()
    expect(pushErrorMock).toHaveBeenCalledWith(
      'Drive sync failed: network down',
      { label: 'Settings', to: '/settings' },
    )
  })

  it('returns null when a sync is already in flight (single-flight lock)', async () => {
    drainMock.mockResolvedValue(undefined)
    const { waitForCall, release } = pausableSync()
    const { requestManualSync } = await loadModule()
    const first = requestManualSync()
    await waitForCall
    const second = await requestManualSync()
    expect(second).toBeNull()
    release()
    expect(await first).toBe(fakeResult)
  })

  it('exposes status transitions through getAutoSyncState', async () => {
    drainMock.mockResolvedValue(undefined)
    const { waitForCall, release } = pausableSync()
    const { requestManualSync, getAutoSyncState } = await loadModule()
    expect(getAutoSyncState()).toEqual({ status: 'idle', error: null, errorKind: null, lastResult: null })
    const inFlight = requestManualSync()
    expect(getAutoSyncState()).toEqual({ status: 'syncing', error: null, errorKind: null, lastResult: null })
    await waitForCall
    release()
    await inFlight
    expect(getAutoSyncState()).toEqual({ status: 'idle', error: null, errorKind: null, lastResult: fakeResult })
  })

  it('reflects error state when sync rejects', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockRejectedValue(new Error('boom'))
    const { requestManualSync, getAutoSyncState } = await loadModule()
    await requestManualSync()
    expect(getAutoSyncState()).toEqual({ status: 'error', error: 'boom', errorKind: 'generic', lastResult: null })
  })

  it('coerces non-Error throws into a string message', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockRejectedValue('odd-shape')
    const { requestManualSync, getAutoSyncState } = await loadModule()
    await requestManualSync()
    expect(getAutoSyncState().error).toBe('odd-shape')
  })

  it('flags account-mismatch errors with errorKind="account-mismatch" and skips the notification', async () => {
    drainMock.mockResolvedValue(undefined)
    const { DriveAccountMismatchError } = await import('./sync')
    syncNowMock.mockRejectedValue(new DriveAccountMismatchError('a@example.com'))
    const { requestManualSync, getAutoSyncState } = await loadModule()
    await requestManualSync()
    expect(getAutoSyncState().errorKind).toBe('account-mismatch')
    // No notification — Settings renders an inline blocking panel instead.
    expect(pushErrorMock).not.toHaveBeenCalled()
  })

  it('flags file-gone errors with errorKind="file-gone" and skips the notification', async () => {
    drainMock.mockResolvedValue(undefined)
    const { DriveFileGoneError } = await import('./sync')
    syncNowMock.mockRejectedValue(new DriveFileGoneError())
    const { requestManualSync, getAutoSyncState } = await loadModule()
    await requestManualSync()
    expect(getAutoSyncState().errorKind).toBe('file-gone')
    expect(pushErrorMock).not.toHaveBeenCalled()
  })

  it('forwards options to syncNow (recreateRemoteIfMissing)', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { requestManualSync } = await loadModule()
    await requestManualSync({ recreateRemoteIfMissing: true })
    expect(syncNowMock).toHaveBeenCalledWith({ recreateRemoteIfMissing: true })
  })
})

describe('clearAutoSyncState', () => {
  it('resets status, error, and lastResult to their initial values', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { requestManualSync, clearAutoSyncState, getAutoSyncState } = await loadModule()
    await requestManualSync()
    expect(getAutoSyncState()).toEqual({ status: 'idle', error: null, errorKind: null, lastResult: fakeResult })
    clearAutoSyncState()
    expect(getAutoSyncState()).toEqual({ status: 'idle', error: null, errorKind: null, lastResult: null })
  })
})
