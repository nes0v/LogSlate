import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, ensureMainAccount } from './schema'
import {
  countAccountData,
  createAccount,
  createAdjustment,
  createTrade,
  deleteAccount,
  deleteAdjustment,
  deleteTrade,
  getTrade,
  listAccounts,
  listAdjustments,
  listAllTrades,
  renameAccount,
  slugifyAccountName,
  updateAdjustment,
  updateTrade,
} from './queries'
import { MAIN_ACCOUNT_ID } from './types'
import { adjustmentDraft, tradeDraft } from '@/test/fixtures'

beforeEach(async () => {
  await db.trades.clear()
  await db.adjustments.clear()
  await db.accounts.clear()
  await db.day_screenshots.clear()
  await db.pending_uploads.clear()
  await ensureMainAccount()
})
afterEach(async () => {
  await db.trades.clear()
  await db.adjustments.clear()
  await db.accounts.clear()
  await db.day_screenshots.clear()
  await db.pending_uploads.clear()
})

describe('trade queries', () => {
  it('createTrade assigns id + timestamps', async () => {
    const t = await createTrade(tradeDraft())
    expect(t.id).toBeTruthy()
    expect(t.created_at).toBeTruthy()
    expect(t.updated_at).toBe(t.created_at)
    expect(t.account_id).toBe(MAIN_ACCOUNT_ID)
  })

  it('getTrade round-trips through storage', async () => {
    const t = await createTrade(tradeDraft({ idea: 'read me back' }))
    const fetched = await getTrade(t.id)
    expect(fetched?.idea).toBe('read me back')
  })

  it('updateTrade bumps updated_at', async () => {
    const t = await createTrade(tradeDraft())
    await new Promise(r => setTimeout(r, 2))
    await updateTrade(t.id, { idea: 'updated' })
    const fetched = await getTrade(t.id)
    expect(fetched?.idea).toBe('updated')
    expect(fetched!.updated_at >= t.updated_at).toBe(true)
  })

  it('deleteTrade removes the record', async () => {
    const t = await createTrade(tradeDraft())
    await deleteTrade(t.id)
    expect(await getTrade(t.id)).toBeUndefined()
  })

  it('listAllTrades returns every stored trade for the account', async () => {
    await createTrade(tradeDraft())
    await createTrade(tradeDraft())
    await createTrade(tradeDraft())
    await createTrade(tradeDraft(), 'other-account')
    expect(await listAllTrades(MAIN_ACCOUNT_ID)).toHaveLength(3)
    expect(await listAllTrades('other-account')).toHaveLength(1)
  })
})

describe('adjustment queries', () => {
  it('createAdjustment assigns id + timestamps + active account', async () => {
    const a = await createAdjustment(adjustmentDraft())
    expect(a.id).toBeTruthy()
    expect(a.created_at).toBe(a.updated_at)
    expect(a.account_id).toBe(MAIN_ACCOUNT_ID)
  })

  it('updateAdjustment bumps updated_at', async () => {
    const a = await createAdjustment(adjustmentDraft({ amount: 100 }))
    await new Promise(r => setTimeout(r, 2))
    await updateAdjustment(a.id, { amount: 200 })
    const [fetched] = await listAdjustments(MAIN_ACCOUNT_ID)
    expect(fetched.amount).toBe(200)
    expect(fetched.updated_at >= a.updated_at).toBe(true)
  })

  it('deleteAdjustment removes the record', async () => {
    const a = await createAdjustment(adjustmentDraft())
    await deleteAdjustment(a.id)
    expect(await listAdjustments(MAIN_ACCOUNT_ID)).toHaveLength(0)
  })

  it('listAdjustments orders by date and scopes by account', async () => {
    await createAdjustment(adjustmentDraft({ date: '2026-04-20' }))
    await createAdjustment(adjustmentDraft({ date: '2026-04-01' }))
    await createAdjustment(adjustmentDraft({ date: '2026-04-10' }))
    await createAdjustment(adjustmentDraft({ date: '2026-04-05' }), 'other-account')
    const out = await listAdjustments(MAIN_ACCOUNT_ID)
    expect(out.map(a => a.date)).toEqual(['2026-04-01', '2026-04-10', '2026-04-20'])
  })
})

describe('slugifyAccountName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyAccountName('Funded Challenge')).toBe('funded-challenge')
  })

  it('collapses runs of non-alphanumeric to a single hyphen', () => {
    expect(slugifyAccountName('  A -- B  ')).toBe('a-b')
    expect(slugifyAccountName('Foo_Bar/Baz')).toBe('foo-bar-baz')
  })

  it('strips accents via NFKD normalization', () => {
    expect(slugifyAccountName('Äccount')).toBe('account')
  })

  it('returns empty string when nothing alphanumeric remains', () => {
    expect(slugifyAccountName('   ')).toBe('')
    expect(slugifyAccountName('!!!')).toBe('')
  })

  it('produces the MAIN_ACCOUNT_ID slug for "Main"', () => {
    expect(slugifyAccountName('Main')).toBe(MAIN_ACCOUNT_ID)
  })
})

describe('account queries', () => {
  it('createAccount derives id from the name slug and is not main', async () => {
    const a = await createAccount({ name: 'Funded Challenge' })
    expect(a.id).toBe('funded-challenge')
    expect(a.is_main).toBe(false)
    expect(a.created_at).toBe(a.updated_at)
  })

  it('createAccount rejects an empty or punctuation-only name', async () => {
    await expect(createAccount({ name: '   ' })).rejects.toThrow(/required/)
    await expect(createAccount({ name: '!!!' })).rejects.toThrow(/letters or numbers/)
  })

  it('createAccount rejects a slug that already exists', async () => {
    await createAccount({ name: 'Alpha' })
    await expect(createAccount({ name: 'alpha' })).rejects.toThrow(/already exists/)
  })

  it('createAccount rejects reusing the Main slug', async () => {
    await expect(createAccount({ name: 'Main' })).rejects.toThrow(/already exists/)
  })

  it('renameAccount updates name and bumps updated_at', async () => {
    const a = await createAccount({ name: 'Alpha' })
    await new Promise(r => setTimeout(r, 2))
    await renameAccount(a.id, 'Beta')
    const all = await listAccounts()
    const fetched = all.find(x => x.id === a.id)!
    expect(fetched.name).toBe('Beta')
    expect(fetched.updated_at > a.updated_at).toBe(true)
  })

  it('renameAccount rejects empty names', async () => {
    const a = await createAccount({ name: 'Alpha' })
    await expect(renameAccount(a.id, '   ')).rejects.toThrow(/required/)
  })

  it('listAccounts puts Main first then alphabetical', async () => {
    await createAccount({ name: 'Zulu' })
    await createAccount({ name: 'Alpha' })
    const all = await listAccounts()
    expect(all.map(a => a.name)).toEqual(['Main', 'Alpha', 'Zulu'])
  })

  it('deleteAccount refuses to delete Main', async () => {
    await expect(deleteAccount(MAIN_ACCOUNT_ID)).rejects.toThrow(/Main/)
  })

  it('deleteAccount cascades to trades and adjustments', async () => {
    const a = await createAccount({ name: 'Alpha' })
    await createTrade(tradeDraft(), a.id)
    await createTrade(tradeDraft(), a.id)
    await createTrade(tradeDraft(), MAIN_ACCOUNT_ID)
    await createAdjustment(adjustmentDraft(), a.id)

    await deleteAccount(a.id)

    expect(await listAccounts()).toHaveLength(1) // Main only
    expect(await listAllTrades(a.id)).toHaveLength(0)
    expect(await listAdjustments(a.id)).toHaveLength(0)
    expect(await listAllTrades(MAIN_ACCOUNT_ID)).toHaveLength(1) // other account untouched
  })

  it('deleteAccount cascades to day_screenshots and pending_uploads', async () => {
    const a = await createAccount({ name: 'Alpha' })
    const now = new Date().toISOString()
    await db.day_screenshots.put({
      id: `${a.id}:2026-04-20`,
      account_id: a.id,
      date: '2026-04-20',
      screenshot: 'drive:fake',
      created_at: now,
      updated_at: now,
    })
    await db.day_screenshots.put({
      id: `${MAIN_ACCOUNT_ID}:2026-04-20`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-20',
      screenshot: 'drive:other',
      created_at: now,
      updated_at: now,
    })
    await db.pending_uploads.put({
      id: 'p1',
      account_id: a.id,
      blob: new Blob(['x']),
      filename: '20-apr-2026-x.png',
      month_key: '2026-04',
      created_at: now,
    })
    await db.pending_uploads.put({
      id: 'p2',
      account_id: MAIN_ACCOUNT_ID,
      blob: new Blob(['y']),
      filename: '20-apr-2026-y.png',
      month_key: '2026-04',
      created_at: now,
    })

    await deleteAccount(a.id)

    expect(await db.day_screenshots.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.day_screenshots.where('account_id').equals(MAIN_ACCOUNT_ID).count()).toBe(1)
    expect(await db.pending_uploads.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.pending_uploads.where('account_id').equals(MAIN_ACCOUNT_ID).count()).toBe(1)
  })

  it('deleteAccount clears the account-scoped localStorage keys', async () => {
    const a = await createAccount({ name: 'Alpha' })
    localStorage.setItem(`logslate:equity_view_default:${a.id}`, 'candles')
    localStorage.setItem(`logslate:drive:screenshots_folder:${a.id}`, 'folder123')
    localStorage.setItem(`logslate:drive:month_folders:${a.id}`, '{"2026-04":"m1"}')
    // Main account's keys should survive.
    localStorage.setItem(`logslate:equity_view_default:${MAIN_ACCOUNT_ID}`, 'curve')

    await deleteAccount(a.id)

    expect(localStorage.getItem(`logslate:equity_view_default:${a.id}`)).toBeNull()
    expect(localStorage.getItem(`logslate:drive:screenshots_folder:${a.id}`)).toBeNull()
    expect(localStorage.getItem(`logslate:drive:month_folders:${a.id}`)).toBeNull()
    expect(localStorage.getItem(`logslate:equity_view_default:${MAIN_ACCOUNT_ID}`)).toBe('curve')
  })

  it('countAccountData reports trade + adjustment counts for the given account', async () => {
    const a = await createAccount({ name: 'Alpha' })
    await createTrade(tradeDraft(), a.id)
    await createTrade(tradeDraft(), a.id)
    await createAdjustment(adjustmentDraft(), a.id)
    await createTrade(tradeDraft(), MAIN_ACCOUNT_ID)

    expect(await countAccountData(a.id)).toEqual({ trades: 2, adjustments: 1 })
    expect(await countAccountData(MAIN_ACCOUNT_ID)).toEqual({ trades: 1, adjustments: 0 })
  })
})

describe('ensureMainAccount', () => {
  it('creates the Main account when absent', async () => {
    await db.accounts.clear()
    await ensureMainAccount()
    const main = await db.accounts.get(MAIN_ACCOUNT_ID)
    expect(main?.name).toBe('Main')
    expect(main?.is_main).toBe(true)
  })

  it('is a no-op when Main already exists (preserves the existing row)', async () => {
    await db.accounts.clear()
    await ensureMainAccount()
    const first = await db.accounts.get(MAIN_ACCOUNT_ID)
    await new Promise(r => setTimeout(r, 2))
    await ensureMainAccount()
    const second = await db.accounts.get(MAIN_ACCOUNT_ID)
    expect(second?.created_at).toBe(first?.created_at)
    expect(second?.updated_at).toBe(first?.updated_at)
  })
})
