import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, ensureMainAccount } from '@/db/schema'
import { createAdjustment, createTrade, listAllTrades, listAdjustments } from '@/db/queries'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import { importBackup } from './backup'
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
    await createTrade(tradeDraft({ idea: 'seed trade' }))
    await createAdjustment(adjustmentDraft({ amount: 100 }))
    const file = await buildBackupFileFromDb()

    // Overwrite with a different db state
    await db.trades.clear()
    await db.adjustments.clear()
    await createTrade(tradeDraft({ idea: 'pre-import' }))

    const result = await importBackup(file)
    expect(result.imported).toBe(1)
    expect(result.adjustments).toBe(1)

    const trades = await listAllTrades(MAIN_ACCOUNT_ID)
    expect(trades).toHaveLength(1)
    expect(trades[0].idea).toBe('seed trade') // pre-import trade was wiped

    const adjustments = await listAdjustments(MAIN_ACCOUNT_ID)
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0].amount).toBe(100)
  })

  it('handles backups without an adjustments field (v2 files)', async () => {
    const payload = { version: 2, trades: [], exported_at: new Date().toISOString() }
    const file = new File([JSON.stringify(payload)], 'legacy.json', { type: 'application/json' })
    const result = await importBackup(file)
    expect(result.imported).toBe(0)
    expect(result.adjustments).toBe(0)
  })

  it('rejects malformed input', async () => {
    const file = new File(['{"foo": 1}'], 'bad.json', { type: 'application/json' })
    await expect(importBackup(file)).rejects.toThrow(/malformed/)
  })
})
