import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, ensureMainAccount } from '@/db/schema'
import { createAdjustment, createTrade, listAllTrades, listAdjustments } from '@/db/queries'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import { exportBackup, importBackup } from './backup'
import { adjustmentDraft, tradeDraft } from '@/test/fixtures'

beforeEach(async () => {
  await db.trades.clear()
  await db.adjustments.clear()
  await db.accounts.clear()
  await ensureMainAccount()
})
afterEach(async () => {
  await db.trades.clear()
  await db.adjustments.clear()
  await db.accounts.clear()
})

async function buildBackupFileFromDb(): Promise<File> {
  const [trades, adjustments] = await Promise.all([
    db.trades.toArray(),
    db.adjustments.toArray(),
  ])
  const payload = {
    version: 3,
    trades,
    adjustments,
    exported_at: new Date().toISOString(),
  }
  return new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' })
}

describe('importBackup', () => {
  it('replaces local trades + adjustments and reports counts', async () => {
    await createTrade(tradeDraft({ notes: 'seed trade' }))
    await createAdjustment(adjustmentDraft({ amount: 100 }))
    const file = await buildBackupFileFromDb()

    // Overwrite with a different db state
    await db.trades.clear()
    await db.adjustments.clear()
    await createTrade(tradeDraft({ notes: 'pre-import' }))

    const result = await importBackup(file)
    expect(result.trades).toBe(1)
    expect(result.adjustments).toBe(1)

    const trades = await listAllTrades(MAIN_ACCOUNT_ID)
    expect(trades).toHaveLength(1)
    expect(trades[0].notes).toBe('seed trade') // pre-import trade was wiped

    const adjustments = await listAdjustments(MAIN_ACCOUNT_ID)
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0].amount).toBe(100)
  })

  it('opens accounts at 0 when the backup predates starting_balance', async () => {
    // Pre-v20 files carry account rows with no balance field at all. They must
    // restore at 0 — what their equity curve showed when the backup was taken —
    // rather than landing as `undefined` and rendering NaN downstream.
    const payload = {
      version: 3,
      trades: [],
      accounts: [
        {
          id: MAIN_ACCOUNT_ID,
          name: 'main',
          is_main: true,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      exported_at: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(payload)], 'legacy.json', {
      type: 'application/json',
    })
    await importBackup(file)
    const acc = await db.accounts.get(MAIN_ACCOUNT_ID)
    expect(acc?.starting_balance).toBe(0)
  })

  it('round-trips a funded account through export and import', async () => {
    await db.accounts.put({
      id: MAIN_ACCOUNT_ID,
      name: 'main',
      is_main: true,
      starting_balance: 50_000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    const payload = {
      version: 3,
      trades: [],
      accounts: await db.accounts.toArray(),
      exported_at: new Date().toISOString(),
    }
    const file = new File([JSON.stringify(payload)], 'backup.json', {
      type: 'application/json',
    })
    await db.accounts.clear()
    await importBackup(file)
    expect((await db.accounts.get(MAIN_ACCOUNT_ID))?.starting_balance).toBe(50_000)
  })

  it('handles backups without an adjustments field (v2 files)', async () => {
    const payload = { version: 2, trades: [], exported_at: new Date().toISOString() }
    const file = new File([JSON.stringify(payload)], 'legacy.json', { type: 'application/json' })
    const result = await importBackup(file)
    expect(result.trades).toBe(0)
    expect(result.adjustments).toBe(0)
  })

  it('rejects malformed input', async () => {
    const file = new File(['{"foo": 1}'], 'bad.json', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/malformed/)
  })

  it('rejects non-JSON content before touching the DB', async () => {
    await createTrade(tradeDraft({ notes: 'must survive' }))
    const file = new File(['not json {{{'], 'bad.json', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/not valid JSON/)
    const trades = await listAllTrades(MAIN_ACCOUNT_ID)
    expect(trades).toHaveLength(1)
    expect(trades[0].notes).toBe('must survive')
  })

  it('rejects when a known table is not an array', async () => {
    await createTrade(tradeDraft({ notes: 'must survive' }))
    const payload = {
      version: 6,
      exported_at: new Date().toISOString(),
      trades: [],
      models: 'oops',
    }
    const file = new File([JSON.stringify(payload)], 'bad.json', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/models is not an array/)
    const trades = await listAllTrades(MAIN_ACCOUNT_ID)
    expect(trades).toHaveLength(1) // pre-import data preserved
  })

  it('rejects rows without a string id', async () => {
    await createTrade(tradeDraft({ notes: 'must survive' }))
    const payload = {
      version: 6,
      exported_at: new Date().toISOString(),
      trades: [{ id: 42, notes: 'wrong-type id' }],
    }
    const file = new File([JSON.stringify(payload)], 'bad.json', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/missing a string id/)
    const trades = await listAllTrades(MAIN_ACCOUNT_ID)
    expect(trades).toHaveLength(1)
  })
})

describe('exportBackup', () => {
  it('writes a JSON blob containing every table and triggers a download', async () => {
    await createTrade(tradeDraft({ notes: 'export me' }))
    await createAdjustment(adjustmentDraft({ amount: 250 }))

    // Capture the Blob handed to URL.createObjectURL so we can inspect the
    // serialised JSON without intercepting the click pipeline.
    let captured: Blob | null = null
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      captured = blob as Blob
      return 'blob:test'
    })
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    await exportBackup()

    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:test')

    expect(captured).toBeTruthy()
    const text = await (captured as unknown as Blob).text()
    const parsed = JSON.parse(text)
    expect(parsed.version).toBeGreaterThan(0)
    expect(parsed.exported_at).toMatch(/^\d{4}-/)
    expect(Array.isArray(parsed.trades)).toBe(true)
    expect(parsed.trades).toHaveLength(1)
    expect(parsed.trades[0].notes).toBe('export me')
    expect(parsed.adjustments).toHaveLength(1)
    expect(parsed.adjustments[0].amount).toBe(250)
    // Empty tables still appear so the import side has a stable shape.
    expect(parsed.accounts).toBeDefined()
    expect(parsed.days).toBeDefined()
    expect(parsed.models).toBeDefined()
  })
})
