import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_TABLE_KEYS } from '@/lib/data-tables'
import { db, ensureMainAccount } from '@/db/schema'
import { createAdjustment, createTrade, listAllTrades, listAdjustments } from '@/db/queries'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import { exportBackup, importBackup } from './backup'
import { readSymbolFilterCache } from '@/lib/symbol-filter-cache'
import { readLastActivityDate } from '@/lib/last-activity-cache'
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

// A backup as export writes it: the version and every table.
function backupFile(tables: Record<string, unknown>, name = 'backup.json'): File {
  const payload = {
    version: 9,
    exported_at: new Date().toISOString(),
    ...Object.fromEntries(
      DATA_TABLE_KEYS.map(k => [k, []]),
    ),
    ...tables,
  }
  return new File([JSON.stringify(payload)], name, { type: 'application/json' })
}

async function buildBackupFileFromDb(): Promise<File> {
  const [trades, adjustments] = await Promise.all([
    db.trades.toArray(),
    db.adjustments.toArray(),
  ])
  return backupFile({ trades, adjustments })
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

  it('round-trips a funded account through export and import', async () => {
    await db.accounts.put({
      id: MAIN_ACCOUNT_ID,
      name: 'main',
      is_main: true,
      starting_balance: 50_000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    const file = backupFile({ accounts: await db.accounts.toArray() })
    await db.accounts.clear()
    await importBackup(file)
    expect((await db.accounts.get(MAIN_ACCOUNT_ID))?.starting_balance).toBe(50_000)
  })

  it('rejects a backup from an older version', async () => {
    const file = new File(
      [JSON.stringify({ ...JSON.parse(await backupFile({}).text()), version: 7 })],
      'old.json',
      { type: 'application/json' },
    )
    await expect(importBackup(file)).rejects.toThrow(/older version/)
  })

  it('rejects a backup from a newer version before touching the DB', async () => {
    await createTrade(tradeDraft({ notes: 'must survive' }))
    const file = new File(
      [JSON.stringify({ ...JSON.parse(await backupFile({}).text()), version: 99 })],
      'newer.json',
      { type: 'application/json' },
    )
    await expect(importBackup(file)).rejects.toThrow(/newer version/)
    expect(await listAllTrades(MAIN_ACCOUNT_ID)).toHaveLength(1)
  })

  it('rejects a backup missing a table', async () => {
    await createTrade(tradeDraft({ notes: 'must survive' }))
    const payload = { version: 9, trades: [], exported_at: new Date().toISOString() }
    const file = new File([JSON.stringify(payload)], 'partial.json', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/is not an array/)
    expect(await listAllTrades(MAIN_ACCOUNT_ID)).toHaveLength(1)
  })

  it('drops caches derived from the database it just replaced', async () => {
    // Both are first-paint seeds read synchronously before any query resolves,
    // so a stale one paints the PREVIOUS database's symbols and date window.
    localStorage.setItem(
      `logslate:symbol_filter_cache:${MAIN_ACCOUNT_ID}`,
      JSON.stringify([{ id: 'gone', name: 'GONE' }]),
    )
    localStorage.setItem(`logslate:last_activity_date:${MAIN_ACCOUNT_ID}`, '2020-01-02')
    await importBackup(backupFile({}))
    expect(readSymbolFilterCache(MAIN_ACCOUNT_ID)).toBeUndefined()
    expect(readLastActivityDate(MAIN_ACCOUNT_ID)).toBeNull()
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
    const file = backupFile({ models: 'oops' })
    await expect(importBackup(file)).rejects.toThrow(/models is not an array/)
    const trades = await listAllTrades(MAIN_ACCOUNT_ID)
    expect(trades).toHaveLength(1) // pre-import data preserved
  })

  it('rejects rows without a string id', async () => {
    await createTrade(tradeDraft({ notes: 'must survive' }))
    const file = backupFile({ trades: [{ id: 42, notes: 'wrong-type id' }] })
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
