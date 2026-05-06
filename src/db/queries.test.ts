import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, ensureMainAccount } from './schema'
import {
  addDayScreenshot,
  countAccountData,
  countTradesUsingModel,
  createAccount,
  createAdjustment,
  createTrade,
  deleteAccount,
  deleteAdjustment,
  deleteTrade,
  getDay,
  getDayNote,
  getTrade,
  listAccounts,
  listAdjustments,
  listAllTrades,
  listDayScreenshotsFor,
  listModels,
  removeDayScreenshot,
  reorderModels,
  setDayNote,
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
  await db.days.clear()
  await db.pending_uploads.clear()
  await db.models.clear()
  await ensureMainAccount()
})
afterEach(async () => {
  await db.trades.clear()
  await db.adjustments.clear()
  await db.accounts.clear()
  await db.days.clear()
  await db.pending_uploads.clear()
  await db.models.clear()
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

  it('listAccounts puts main first then alphabetical', async () => {
    await createAccount({ name: 'Zulu' })
    await createAccount({ name: 'Alpha' })
    const all = await listAccounts()
    expect(all.map(a => a.name)).toEqual(['main', 'Alpha', 'Zulu'])
  })

  it('deleteAccount refuses to remove the last remaining account', async () => {
    // Only the auto-seeded Main exists at this point.
    await expect(deleteAccount(MAIN_ACCOUNT_ID)).rejects.toThrow(/at least one/i)
  })

  it('deleteAccount allows removing Main when other accounts exist', async () => {
    await createAccount({ name: 'Alpha' })
    await deleteAccount(MAIN_ACCOUNT_ID)
    const remaining = await listAccounts()
    expect(remaining.map(a => a.name)).toEqual(['Alpha'])
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

  it('deleteAccount cascades to days and pending_uploads', async () => {
    const a = await createAccount({ name: 'Alpha' })
    const now = new Date().toISOString()
    await db.days.put({
      id: `${a.id}:2026-04-20`,
      account_id: a.id,
      date: '2026-04-20',
      screenshots: ['drive:fake'],
      created_at: now,
      updated_at: now,
    })
    await db.days.put({
      id: `${MAIN_ACCOUNT_ID}:2026-04-20`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-20',
      screenshots: ['drive:other'],
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

    expect(await db.days.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.days.where('account_id').equals(MAIN_ACCOUNT_ID).count()).toBe(1)
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

describe('day queries', () => {
  const ACCT = MAIN_ACCOUNT_ID
  const DATE = '2026-04-20'

  describe('getDay / listDayScreenshotsFor / getDayNote', () => {
    it('return defaults when the row is absent', async () => {
      expect(await getDay(ACCT, DATE)).toBeUndefined()
      expect(await listDayScreenshotsFor(ACCT, DATE)).toEqual([])
      expect(await getDayNote(ACCT, DATE)).toBe('')
    })
  })

  describe('addDayScreenshot', () => {
    it('creates the row when none exists', async () => {
      const day = await addDayScreenshot(ACCT, DATE, 'drive:abc')
      expect(day.screenshots).toEqual(['drive:abc'])
      expect(day.account_id).toBe(ACCT)
      expect(day.date).toBe(DATE)
      expect(day.id).toBe(`${ACCT}:${DATE}`)
      expect(day.created_at).toBe(day.updated_at)
    })

    it('appends to an existing row and bumps updated_at', async () => {
      const first = await addDayScreenshot(ACCT, DATE, 'drive:a')
      await new Promise(r => setTimeout(r, 2))
      const second = await addDayScreenshot(ACCT, DATE, 'drive:b')
      expect(second.screenshots).toEqual(['drive:a', 'drive:b'])
      expect(second.created_at).toBe(first.created_at)
      expect(second.updated_at >= first.updated_at).toBe(true)
    })
  })

  describe('removeDayScreenshot', () => {
    it('drops the matching screenshot from a multi-entry row', async () => {
      await addDayScreenshot(ACCT, DATE, 'drive:a')
      await addDayScreenshot(ACCT, DATE, 'drive:b')
      await removeDayScreenshot(ACCT, DATE, 'drive:a')
      expect(await listDayScreenshotsFor(ACCT, DATE)).toEqual(['drive:b'])
    })

    it('deletes the row when removing the last screenshot and no note', async () => {
      await addDayScreenshot(ACCT, DATE, 'drive:a')
      await removeDayScreenshot(ACCT, DATE, 'drive:a')
      expect(await getDay(ACCT, DATE)).toBeUndefined()
    })

    it('keeps the row when a note is present and screenshots empty', async () => {
      await setDayNote(ACCT, DATE, 'reflection')
      await addDayScreenshot(ACCT, DATE, 'drive:a')
      await removeDayScreenshot(ACCT, DATE, 'drive:a')
      const day = await getDay(ACCT, DATE)
      expect(day?.screenshots).toEqual([])
      expect(day?.note).toBe('reflection')
    })

    it('is a no-op when the row does not exist', async () => {
      await expect(removeDayScreenshot(ACCT, DATE, 'drive:missing')).resolves.toBeUndefined()
    })
  })

  describe('setDayNote', () => {
    it('creates the row when one does not exist', async () => {
      await setDayNote(ACCT, DATE, 'first thought')
      expect(await getDayNote(ACCT, DATE)).toBe('first thought')
    })

    it('does not create a row when the note is empty', async () => {
      await setDayNote(ACCT, DATE, '   ')
      expect(await getDay(ACCT, DATE)).toBeUndefined()
    })

    it('updates an existing row in place', async () => {
      await setDayNote(ACCT, DATE, 'first')
      await new Promise(r => setTimeout(r, 2))
      await setDayNote(ACCT, DATE, 'second')
      expect(await getDayNote(ACCT, DATE)).toBe('second')
    })

    it('clears the note while preserving the row when screenshots remain', async () => {
      await addDayScreenshot(ACCT, DATE, 'drive:a')
      await setDayNote(ACCT, DATE, 'a thought')
      await setDayNote(ACCT, DATE, '')
      const day = await getDay(ACCT, DATE)
      expect(day?.note).toBeUndefined()
      expect(day?.screenshots).toEqual(['drive:a'])
    })

    it('deletes the row when both note and screenshots become empty', async () => {
      await setDayNote(ACCT, DATE, 'a thought')
      await setDayNote(ACCT, DATE, '')
      expect(await getDay(ACCT, DATE)).toBeUndefined()
    })

    it('treats whitespace-only input as empty', async () => {
      await setDayNote(ACCT, DATE, 'real')
      await setDayNote(ACCT, DATE, '   \n\t ')
      expect(await getDay(ACCT, DATE)).toBeUndefined()
    })
  })
})

describe('ensureMainAccount', () => {
  it('creates the main account when absent', async () => {
    await db.accounts.clear()
    await ensureMainAccount()
    const main = await db.accounts.get(MAIN_ACCOUNT_ID)
    expect(main?.name).toBe('main')
    expect(main?.is_main).toBe(true)
  })

  it('is a no-op when main already exists (preserves the existing row)', async () => {
    await db.accounts.clear()
    await ensureMainAccount()
    const first = await db.accounts.get(MAIN_ACCOUNT_ID)
    await new Promise(r => setTimeout(r, 2))
    await ensureMainAccount()
    const second = await db.accounts.get(MAIN_ACCOUNT_ID)
    expect(second?.created_at).toBe(first?.created_at)
    expect(second?.updated_at).toBe(first?.updated_at)
  })

  it('does not resurrect Main when another account exists (deleted-Main case)', async () => {
    // Simulate the user having deleted Main after creating another account.
    await createAccount({ name: 'Alpha' })
    await db.accounts.delete(MAIN_ACCOUNT_ID)
    await ensureMainAccount()
    const all = await listAccounts()
    expect(all.map(a => a.name)).toEqual(['Alpha'])
  })
})

describe('model queries', () => {
  async function putModel(
    id: string,
    name: string,
    opts: { accountId?: string; sort?: number } = {},
  ) {
    const ts = new Date().toISOString()
    await db.models.put({
      id,
      account_id: opts.accountId ?? MAIN_ACCOUNT_ID,
      name,
      description: '',
      sessions: [],
      groups: [],
      archived: false,
      sort: opts.sort,
      created_at: ts,
      updated_at: ts,
    })
  }

  it('listModels falls back to alphabetical (case-insensitive) when no sort is set', async () => {
    await putModel('m1', 'beta')
    await putModel('m2', 'Alpha')
    await putModel('m3', 'gamma', { accountId: 'other-account' })
    const rows = await listModels(MAIN_ACCOUNT_ID)
    expect(rows.map(m => m.name)).toEqual(['Alpha', 'beta'])
  })

  it('listModels respects the user-set sort order', async () => {
    await putModel('m1', 'beta', { sort: 2 })
    await putModel('m2', 'Alpha', { sort: 3 })
    await putModel('m3', 'gamma', { sort: 1 })
    const rows = await listModels(MAIN_ACCOUNT_ID)
    expect(rows.map(m => m.name)).toEqual(['gamma', 'beta', 'Alpha'])
  })

  it('listModels puts rows with no sort at the bottom, alphabetical among themselves', async () => {
    await putModel('m1', 'sorted-2', { sort: 2 })
    await putModel('m2', 'sorted-1', { sort: 1 })
    await putModel('m3', 'unsorted-zeta')
    await putModel('m4', 'unsorted-alpha')
    const rows = await listModels(MAIN_ACCOUNT_ID)
    expect(rows.map(m => m.name)).toEqual([
      'sorted-1',
      'sorted-2',
      'unsorted-alpha',
      'unsorted-zeta',
    ])
  })

  it('reorderModels assigns 1..N to each id in the supplied order', async () => {
    await putModel('m1', 'first')
    await putModel('m2', 'second')
    await putModel('m3', 'third')
    await reorderModels(['m3', 'm1', 'm2'])
    const rows = await listModels(MAIN_ACCOUNT_ID)
    expect(rows.map(m => m.id)).toEqual(['m3', 'm1', 'm2'])
    expect(rows.map(m => m.sort)).toEqual([1, 2, 3])
  })

  it('reorderModels bumps updated_at on every renumbered row', async () => {
    await putModel('m1', 'a')
    await putModel('m2', 'b')
    const before = await listModels(MAIN_ACCOUNT_ID)
    await new Promise(r => setTimeout(r, 5))
    await reorderModels(['m2', 'm1'])
    const after = await listModels(MAIN_ACCOUNT_ID)
    for (const m of after) {
      const prev = before.find(b => b.id === m.id)!
      expect(m.updated_at > prev.updated_at).toBe(true)
    }
  })

  it('reorderModels is a no-op for an empty list', async () => {
    await putModel('m1', 'unchanged', { sort: 7 })
    await reorderModels([])
    const rows = await listModels(MAIN_ACCOUNT_ID)
    expect(rows[0].sort).toBe(7)
  })

  it('listModels returns an empty array when the account has no models', async () => {
    const rows = await listModels(MAIN_ACCOUNT_ID)
    expect(rows).toEqual([])
  })

  it('countTradesUsingModel hits the [account_id+model_id] index', async () => {
    await putModel('m-target', 'target')
    await createTrade(tradeDraft({ model_id: 'm-target' }))
    await createTrade(tradeDraft({ model_id: 'm-target' }))
    await createTrade(tradeDraft({ model_id: 'm-other' }))
    await createTrade(tradeDraft({ model_id: null }))
    expect(await countTradesUsingModel(MAIN_ACCOUNT_ID, 'm-target')).toBe(2)
    expect(await countTradesUsingModel(MAIN_ACCOUNT_ID, 'm-other')).toBe(1)
    expect(await countTradesUsingModel(MAIN_ACCOUNT_ID, 'm-missing')).toBe(0)
  })

  it('countTradesUsingModel scopes by account', async () => {
    await createAccount({ name: 'Alt' })
    const altId = (await listAccounts()).find(a => a.name === 'Alt')!.id
    await createTrade(tradeDraft({ model_id: 'shared' }))
    await createTrade(tradeDraft({ model_id: 'shared' }), altId)
    expect(await countTradesUsingModel(MAIN_ACCOUNT_ID, 'shared')).toBe(1)
    expect(await countTradesUsingModel(altId, 'shared')).toBe(1)
  })
})
