// Covers the auto-sync orchestrator: manual sync, error routing, drive
// state transitions, online event, and the in-flight (`isSyncing`) lock
// that prevents recursive sync from the bulkAdd hooks.
//
// Module-level state in auto-sync.ts (singleton `isSyncing`, the
// debounce timer, the `initialized` flag) means each test needs a fresh
// module instance — done via `vi.resetModules()` + dynamic import.
// `window.addEventListener` is spied so the captured handler can be
// invoked directly without accumulating live listeners across tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveScopeError } from './drive'

let driveSubscriber: (() => void) | null = null
let tableHooks: {
  creating: ((...args: unknown[]) => void) | null
  updating: ((...args: unknown[]) => void) | null
  deleting: ((...args: unknown[]) => void) | null
}
let onlineHandler: (() => void) | null = null
let driveStatus: 'signed-in' | 'signed-out' | 'signing-in' = 'signed-out'

const syncNowMock = vi.fn<() => Promise<unknown>>()
const drainMock = vi.fn<() => Promise<void>>()
const pushErrorMock = vi.fn<(message: string, action?: unknown) => string>(() => 'notif-id')

vi.mock('./drive', async () => {
  const actual = await vi.importActual<typeof import('./drive')>('./drive')
  return {
    ...actual,
    getDriveState: () => ({ status: driveStatus, error: null }),
    subscribeDrive: (fn: () => void) => {
      driveSubscriber = fn
      return () => {
        driveSubscriber = null
      }
    },
  }
})

vi.mock('./drive-images', () => ({
  drainPendingUploads: () => drainMock(),
}))

vi.mock('./sync', () => ({
  syncedTables: () => [
    {
      hook: (event: 'creating' | 'updating' | 'deleting', fn: () => void) => {
        tableHooks[event] = fn
      },
    },
  ],
  syncNow: () => syncNowMock(),
}))

vi.mock('./notifications', () => ({
  pushError: (message: string, action?: unknown) => pushErrorMock(message, action),
}))

beforeEach(() => {
  vi.resetModules()
  driveSubscriber = null
  tableHooks = { creating: null, updating: null, deleting: null }
  onlineHandler = null
  driveStatus = 'signed-out'
  syncNowMock.mockReset()
  drainMock.mockReset()
  pushErrorMock.mockReset().mockReturnValue('notif-id')

  // Capture, don't attach, the `online` listener — otherwise every
  // initAutoSync call piles a new live listener on the same DOM window
  // and a single dispatchEvent fires them all.
  vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'online' && typeof handler === 'function') {
      onlineHandler = handler as () => void
    }
  })
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
    expect(getAutoSyncState()).toEqual({ status: 'idle', error: null })
    const inFlight = requestManualSync()
    expect(getAutoSyncState()).toEqual({ status: 'syncing', error: null })
    await waitForCall
    release()
    await inFlight
    expect(getAutoSyncState()).toEqual({ status: 'idle', error: null })
  })

  it('reflects error state when sync rejects', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockRejectedValue(new Error('boom'))
    const { requestManualSync, getAutoSyncState } = await loadModule()
    await requestManualSync()
    expect(getAutoSyncState()).toEqual({ status: 'error', error: 'boom' })
  })

  it('coerces non-Error throws into a string message', async () => {
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockRejectedValue('odd-shape')
    const { requestManualSync, getAutoSyncState } = await loadModule()
    await requestManualSync()
    expect(getAutoSyncState().error).toBe('odd-shape')
  })
})

describe('initAutoSync', () => {
  it('triggers an initial sync when boot finds a signed-in drive state', async () => {
    driveStatus = 'signed-in'
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { initAutoSync } = await loadModule()
    initAutoSync()
    await Promise.resolve()
    await Promise.resolve()
    expect(syncNowMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT trigger a sync when boot finds a signed-out drive state', async () => {
    driveStatus = 'signed-out'
    const { initAutoSync } = await loadModule()
    initAutoSync()
    await Promise.resolve()
    expect(syncNowMock).not.toHaveBeenCalled()
  })

  it('triggers a sync on the signed-out → signed-in transition', async () => {
    driveStatus = 'signed-out'
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { initAutoSync } = await loadModule()
    initAutoSync()
    expect(syncNowMock).not.toHaveBeenCalled()
    driveStatus = 'signed-in'
    driveSubscriber?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(syncNowMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-trigger when transitioning between non-signed-in states', async () => {
    driveStatus = 'signed-out'
    const { initAutoSync } = await loadModule()
    initAutoSync()
    driveStatus = 'signing-in'
    driveSubscriber?.()
    await Promise.resolve()
    expect(syncNowMock).not.toHaveBeenCalled()
  })

  it('does NOT re-trigger when the subscriber fires while already signed-in', async () => {
    driveStatus = 'signed-in'
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { initAutoSync } = await loadModule()
    initAutoSync()
    await Promise.resolve()
    await Promise.resolve()
    expect(syncNowMock).toHaveBeenCalledTimes(1)
    driveSubscriber?.()
    await Promise.resolve()
    expect(syncNowMock).toHaveBeenCalledTimes(1)
  })

  it('triggers a sync on the window `online` event when signed-in', async () => {
    driveStatus = 'signed-in'
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { initAutoSync } = await loadModule()
    initAutoSync()
    await Promise.resolve()
    await Promise.resolve()
    expect(syncNowMock).toHaveBeenCalledTimes(1)
    onlineHandler?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(syncNowMock).toHaveBeenCalledTimes(2)
  })

  it('is idempotent — calling initAutoSync twice attaches hooks only once', async () => {
    driveStatus = 'signed-in'
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { initAutoSync } = await loadModule()
    initAutoSync()
    initAutoSync()
    await Promise.resolve()
    await Promise.resolve()
    expect(syncNowMock).toHaveBeenCalledTimes(1)
  })
})

describe('table hooks → debounced push', () => {
  it('debounces a write into a single sync after the wait', async () => {
    vi.useFakeTimers()
    driveStatus = 'signed-in'
    drainMock.mockResolvedValue(undefined)
    syncNowMock.mockResolvedValue(fakeResult)
    const { initAutoSync } = await loadModule()
    initAutoSync()
    await vi.runAllTimersAsync()
    syncNowMock.mockClear()

    tableHooks.creating?.()
    tableHooks.updating?.()
    tableHooks.deleting?.()
    expect(syncNowMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3500)
    expect(syncNowMock).toHaveBeenCalledTimes(1)
  })

  it('does not schedule another sync from a hook while a sync is already in flight', async () => {
    vi.useFakeTimers()
    driveStatus = 'signed-in'
    drainMock.mockResolvedValue(undefined)
    const { waitForCall, release } = pausableSync()
    const { initAutoSync } = await loadModule()
    initAutoSync()
    // Advance microtasks (fake timer mode still resolves microtasks);
    // drain resolves, syncNow is called and pauses.
    await waitForCall

    tableHooks.creating?.()
    await vi.advanceTimersByTimeAsync(5000)
    // syncNow was called exactly once (the boot sync) — the hook fired
    // under the in-flight lock and must not schedule a second run.
    expect(syncNowMock).toHaveBeenCalledTimes(1)
    release()
  })
})
