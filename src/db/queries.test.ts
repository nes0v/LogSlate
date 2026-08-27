import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, ensureMainAccount } from './schema'
import {
  addDayScreenshot,
  addPendingDayScreenshot,
  cloneAccount,
  countAccountData,
  countTradesUsingModel,
  createAccount,
  createSymbol,
  createAdjustment,
  createTrade,
  deleteAccount,
  deleteAdjustment,
  deleteTrade,
  getAccount,
  getDay,
  getDayNote,
  getTrade,
  listAccounts,
  listAdjustments,
  listAllTrades,
  listDayScreenshotsFor,
  listModels,
  listSymbols,
  getDayPnlOverride,
  getDayFeesOverride,
  listDayOverrides,
  removeDayScreenshot,
  reorderModels,
  getDayReflection,
  setDayNote,
  setDayReflection,
  setDayFeesOverride,
  setDayPnlOverride,
  slugifyAccountName,
  updateAdjustment,
  updateTrade,
} from './queries'
import { MAIN_ACCOUNT_ID } from './types'
import { readSymbolFilterCache } from '@/lib/symbol-filter-cache'
import { adjustmentDraft, tradeDraft } from '@/test/fixtures'

beforeEach(async () => {
  await db.trades.clear()
  await db.adjustments.clear()
  await db.accounts.clear()
  await db.days.clear()
  await db.pending_uploads.clear()
  await db.models.clear()
  await db.symbols.clear()
  await db.progress_rules.clear()
  await db.progress_checks.clear()
  // Account ids are name slugs, so tests reusing a name reuse its id — and the
  // per-account localStorage caches (symbol filter, Drive folders) are keyed on
  // exactly that. Without this, one test's cache is visible to the next.
  localStorage.clear()
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
    const t = await createTrade(tradeDraft({ notes: 'read me back' }))
    const fetched = await getTrade(t.id)
    expect(fetched?.notes).toBe('read me back')
  })

  it('updateTrade bumps updated_at', async () => {
    const t = await createTrade(tradeDraft())
    await new Promise(r => setTimeout(r, 2))
    await updateTrade(t.id, { notes: 'updated' })
    const fetched = await getTrade(t.id)
    expect(fetched?.notes).toBe('updated')
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

describe('weekend guard', () => {
  // 2026-04-18 is a Saturday, 2026-04-19 a Sunday; 2026-04-17 a Friday.
  it('createTrade rejects a weekend-dated trade', async () => {
    await expect(createTrade(tradeDraft({ date: '2026-04-18' }))).rejects.toThrow(/weekend/i)
    expect(await listAllTrades(MAIN_ACCOUNT_ID)).toHaveLength(0)
  })

  it('createAdjustment rejects a weekend-dated deposit', async () => {
    await expect(createAdjustment(adjustmentDraft({ date: '2026-04-19' }))).rejects.toThrow(/weekend/i)
    expect(await listAdjustments(MAIN_ACCOUNT_ID)).toHaveLength(0)
  })

  it('setDayPnlOverride rejects a weekend date but still allows clearing', async () => {
    await expect(setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-18', -500)).rejects.toThrow(/weekend/i)
    // Clearing a (legacy) weekend row is always allowed.
    await expect(setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-18', null)).resolves.toBeUndefined()
  })

  it('accepts a weekday date', async () => {
    await createTrade(tradeDraft({ date: '2026-04-17' }))
    expect(await listAllTrades(MAIN_ACCOUNT_ID)).toHaveLength(1)
  })
})

describe('day-override / trade mutual exclusion', () => {
  it('createTrade rejects a trade on a day that has a PNL override', async () => {
    await setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15', -1000)
    await expect(createTrade(tradeDraft({ date: '2026-04-15' }))).rejects.toThrow(/override/i)
    expect(await listAllTrades(MAIN_ACCOUNT_ID)).toHaveLength(0)
  })

  it('updateTrade refuses to move a trade onto a day that has an override', async () => {
    // The create path is guarded above; the edit path can reach the same
    // contradictory state by changing an existing trade's date.
    const t = await createTrade(tradeDraft({ date: '2026-04-15' }))
    await setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-16', -100)
    await expect(updateTrade(t.id, { date: '2026-04-16' })).rejects.toThrow(/override/i)
  })

  it('createTrade allows trades on a different day than the override', async () => {
    await setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15', -1000)
    await createTrade(tradeDraft({ date: '2026-04-16' }))
    expect(await listAllTrades(MAIN_ACCOUNT_ID)).toHaveLength(1)
  })

  it('setDayPnlOverride rejects an override on a day that has trades', async () => {
    await createTrade(tradeDraft({ date: '2026-04-15' }))
    await expect(setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15', -1000)).rejects.toThrow(/trade/i)
    expect(await getDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15')).toBeNull()
  })

  it('setDayPnlOverride(null) clears even when trades exist (recovers a legacy both-day)', async () => {
    // Force a contradictory legacy row directly, bypassing the guard.
    await db.days.put({
      id: `${MAIN_ACCOUNT_ID}:2026-04-15`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-15',
      screenshots: [],
      pnl_override: -1000,
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    })
    await createTrade(tradeDraft({ date: '2026-04-15' })) // would normally be blocked
      .catch(() => {})
    await db.trades.add({
      ...tradeDraft({ date: '2026-04-15' }),
      id: 'legacy-trade',
      account_id: MAIN_ACCOUNT_ID,
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    })
    await setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15', null)
    expect(await getDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15')).toBeNull()
  })
})

describe('day fees override', () => {
  it('no-ops when the day has no PNL override (fees alone is meaningless)', async () => {
    await setDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15', 80)
    expect(await getDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15')).toBeNull()
    expect(await getDay(MAIN_ACCOUNT_ID, '2026-04-15')).toBeUndefined()
  })

  it('stores fees on an override day and clearing the net drops the fees', async () => {
    await setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15', 295)
    await setDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15', 80)
    expect(await getDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15')).toBe(80)
    expect((await listDayOverrides(MAIN_ACCOUNT_ID)).fees).toEqual(
      new Map([['2026-04-15', 80]]),
    )

    // Clearing the net override orphans the fees, so they're dropped too —
    // and the now-empty row is garbage-collected.
    await setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15', null)
    expect(await getDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15')).toBeNull()
    expect(await getDay(MAIN_ACCOUNT_ID, '2026-04-15')).toBeUndefined()
  })

  it('stores the magnitude so a negative fee adds to the total, not subtracts', async () => {
    await setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15', 295)
    await setDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15', -80)
    expect(await getDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15')).toBe(80)
  })

  it('setDayFeesOverride(null) clears fees but keeps the net override', async () => {
    await setDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15', 295)
    await setDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15', 80)
    await setDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15', null)
    expect(await getDayFeesOverride(MAIN_ACCOUNT_ID, '2026-04-15')).toBeNull()
    expect(await getDayPnlOverride(MAIN_ACCOUNT_ID, '2026-04-15')).toBe(295)
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
    await createAdjustment(adjustmentDraft({ date: '2026-04-06' }), 'other-account')
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
    const a = await createAccount({ name: 'Funded Challenge', starting_balance: 0 })
    expect(a.id).toBe('funded-challenge')
    expect(a.is_main).toBe(false)
    expect(a.created_at).toBe(a.updated_at)
  })

  it('createAccount rejects an empty or punctuation-only name', async () => {
    await expect(createAccount({ name: '   ', starting_balance: 0 })).rejects.toThrow(/required/)
    await expect(createAccount({ name: '!!!', starting_balance: 0 })).rejects.toThrow(/letters or numbers/)
  })

  it('createAccount stores the opening balance', async () => {
    const a = await createAccount({ name: 'Eval', starting_balance: 50_000 })
    expect(a.starting_balance).toBe(50_000)
    expect((await getAccount('eval'))?.starting_balance).toBe(50_000)
  })

  it('createAccount rejects a negative or non-finite opening balance', async () => {
    await expect(createAccount({ name: 'Neg', starting_balance: -1 })).rejects.toThrow(
      /zero or a positive number/,
    )
    await expect(createAccount({ name: 'Nan', starting_balance: NaN })).rejects.toThrow(
      /zero or a positive number/,
    )
  })

  it('createAccount rejects a slug that already exists', async () => {
    await createAccount({ name: 'Alpha', starting_balance: 0 })
    // The message names the account that was actually hit — the collision is
    // on the slug, so the two names need not look alike.
    await expect(createAccount({ name: 'alpha', starting_balance: 0 })).rejects.toThrow(
      /collides with the existing account "Alpha"/,
    )
    // Space and hyphen both collapse to the same separator, so these two
    // visibly different names land on the identical slug.
    await createAccount({ name: 'Eval 1', starting_balance: 0 })
    await expect(createAccount({ name: 'Eval-1', starting_balance: 0 })).rejects.toThrow(
      /collides with the existing account "Eval 1"/,
    )
  })

  it('createAccount rejects reusing the Main slug', async () => {
    await expect(createAccount({ name: 'Main', starting_balance: 0 })).rejects.toThrow(/collides/)
  })

  describe('cloneAccount', () => {
    // A source account carrying one of everything the clone touches, plus a
    // hidden rule and a trade that must NOT come along.
    async function seedSource() {
      const ts = '2026-01-02T00:00:00.000Z'
      await db.models.put({
        id: 'src-model',
        account_id: MAIN_ACCOUNT_ID,
        name: 'Breakout',
        description: 'the playbook',
        sessions: ['am'],
        groups: [{ id: 'grp-1', name: 'Entry', rules: ['wait for the retest'] }],
        draft: false,
        sort: 3,
        created_at: ts,
        updated_at: ts,
      })
      await createSymbol(
        {
          name: 'NQ',
          description: '',
          point_value: 20,
          tick_size: 0.25,
          fee_per_side: 1.24,
          scratch_handles: 2,
          draft: false,
          sort: 1,
        },
        MAIN_ACCOUNT_ID,
      )
      await db.progress_rules.bulkPut([
        {
          id: 'src-rule',
          account_id: MAIN_ACCOUNT_ID,
          text: 'no trades before 9:45',
          periods: [{ from: '2026-01-02', until: null }],
          sort: 2,
          created_at: ts,
          updated_at: ts,
        },
        {
          id: 'src-hidden',
          account_id: MAIN_ACCOUNT_ID,
          text: 'retired rule',
          periods: [{ from: '2025-01-02', until: '2025-06-01' }],
          hidden: true,
          sort: 1,
          created_at: ts,
          updated_at: ts,
        },
      ])
      await createTrade(tradeDraft())
    }

    it('copies models, symbols and rules under fresh ids', async () => {
      await seedSource()
      const clone = await cloneAccount(
        { name: 'Eval 2', starting_balance: 50_000 },
        MAIN_ACCOUNT_ID,
      )

      const models = await listModels(clone.id)
      expect(models).toHaveLength(1)
      expect(models[0].id).not.toBe('src-model')
      expect(models[0].name).toBe('Breakout')
      expect(models[0].sort).toBe(3)
      expect(models[0].groups[0].rules).toEqual(['wait for the retest'])
      expect(models[0].groups[0].id).not.toBe('grp-1')

      const symbols = await listSymbols(clone.id)
      expect(symbols.map(s => s.name)).toEqual(['NQ'])
      expect(symbols[0].point_value).toBe(20)

      // Source keeps its own copies — a clone is never a move.
      expect(await listModels(MAIN_ACCOUNT_ID)).toHaveLength(1)
      expect(await listSymbols(MAIN_ACCOUNT_ID)).toHaveLength(1)
    })

    it('cloned rules arrive switched off, skipping hidden ones', async () => {
      await seedSource()
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, MAIN_ACCOUNT_ID)
      const rules = await db.progress_rules.where('account_id').equals(clone.id).toArray()
      expect(rules).toHaveLength(1)
      expect(rules[0].text).toBe('no trades before 9:45')
      // No periods, so the rule counts toward nothing until the user enables it.
      expect(rules[0].periods).toEqual([])
      expect(rules[0].sort).toBe(2)
    })

    it('seeds the symbol filter cache so the clone paints its pills immediately', async () => {
      await seedSource()
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, MAIN_ACCOUNT_ID)
      const cached = readSymbolFilterCache(clone.id)
      expect(cached?.map(s => s.name)).toEqual(['NQ'])
      // Same rows that landed in the table, not the source's.
      expect(cached?.[0].account_id).toBe(clone.id)
    })

    it('writes no cache entry when the source has no symbols', async () => {
      await db.symbols.clear()
      const clone = await cloneAccount({ name: 'Bare', starting_balance: 0 }, MAIN_ACCOUNT_ID)
      // An empty cache reads the same as none, so writing one is a stray key.
      expect(readSymbolFilterCache(clone.id)).toBeUndefined()
    })

    it('takes the balance from the draft, not from the source account', async () => {
      await db.accounts.update(MAIN_ACCOUNT_ID, { starting_balance: 25_000 })
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 50_000 }, MAIN_ACCOUNT_ID)
      expect(clone.starting_balance).toBe(50_000)
      expect((await getAccount(MAIN_ACCOUNT_ID))?.starting_balance).toBe(25_000)
    })

    it('copies no history', async () => {
      await seedSource()
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, MAIN_ACCOUNT_ID)
      const counts = await countAccountData(clone.id)
      expect(counts.trades).toBe(0)
      expect(counts.adjustments).toBe(0)
      expect(counts.days).toBe(0)
      expect(counts.progressChecks).toBe(0)
    })

    it('leaves nothing behind when the name is rejected', async () => {
      await seedSource()
      await expect(
        cloneAccount({ name: 'main', starting_balance: 0 }, MAIN_ACCOUNT_ID),
      ).rejects.toThrow(/collides/)
      expect(await db.accounts.count()).toBe(1)
      expect(await db.models.count()).toBe(1)
    })

    it('rejects an unknown source account', async () => {
      await expect(
        cloneAccount({ name: 'Eval 2', starting_balance: 0 }, 'nope'),
      ).rejects.toThrow(/no longer exists/)
      expect(await db.accounts.count()).toBe(1)
    })
  })

  it('listAccounts puts main first then alphabetical', async () => {
    await createAccount({ name: 'Zulu', starting_balance: 0 })
    await createAccount({ name: 'Alpha', starting_balance: 0 })
    const all = await listAccounts()
    expect(all.map(a => a.name)).toEqual(['main', 'Alpha', 'Zulu'])
  })

  it('deleteAccount refuses to remove the last remaining account', async () => {
    // Only the auto-seeded Main exists at this point.
    await expect(deleteAccount(MAIN_ACCOUNT_ID)).rejects.toThrow(/at least one/i)
  })

  it('deleteAccount allows removing Main when other accounts exist', async () => {
    await createAccount({ name: 'Alpha', starting_balance: 0 })
    await deleteAccount(MAIN_ACCOUNT_ID)
    const remaining = await listAccounts()
    expect(remaining.map(a => a.name)).toEqual(['Alpha'])
  })

  it('deleteAccount cascades to trades and adjustments', async () => {
    const a = await createAccount({ name: 'Alpha', starting_balance: 0 })
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
    const a = await createAccount({ name: 'Alpha', starting_balance: 0 })
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

  it('deleteAccount cascades to models, progress_rules, and progress_checks', async () => {
    const a = await createAccount({ name: 'Alpha', starting_balance: 0 })
    const now = new Date().toISOString()
    await db.models.put({
      id: 'm-alpha',
      account_id: a.id,
      name: 'Alpha model',
      description: '',
      sessions: [],
      groups: [],
      draft: false,
      created_at: now,
      updated_at: now,
    })
    await db.models.put({
      id: 'm-main',
      account_id: MAIN_ACCOUNT_ID,
      name: 'Main model',
      description: '',
      sessions: [],
      groups: [],
      draft: false,
      created_at: now,
      updated_at: now,
    })
    await db.progress_rules.put({
      id: 'r-alpha',
      account_id: a.id,
      text: 'Review yesterday',
      periods: [{ from: '2026-01-01', until: null }],
      sort: 1,
      created_at: now,
      updated_at: now,
    })
    await db.progress_rules.put({
      id: 'r-main',
      account_id: MAIN_ACCOUNT_ID,
      text: 'Review yesterday',
      periods: [{ from: '2026-01-01', until: null }],
      sort: 1,
      created_at: now,
      updated_at: now,
    })
    await db.progress_checks.put({
      id: `${a.id}:2026-04-20:r-alpha`,
      account_id: a.id,
      date: '2026-04-20',
      rule_id: 'r-alpha',
      checked: true,
      created_at: now,
      updated_at: now,
    })
    await db.progress_checks.put({
      id: `${MAIN_ACCOUNT_ID}:2026-04-20:r-main`,
      account_id: MAIN_ACCOUNT_ID,
      date: '2026-04-20',
      rule_id: 'r-main',
      checked: true,
      created_at: now,
      updated_at: now,
    })

    await deleteAccount(a.id)

    expect(await db.models.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.models.where('account_id').equals(MAIN_ACCOUNT_ID).count()).toBe(1)
    expect(await db.progress_rules.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.progress_rules.where('account_id').equals(MAIN_ACCOUNT_ID).count()).toBe(1)
    expect(await db.progress_checks.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.progress_checks.where('account_id').equals(MAIN_ACCOUNT_ID).count()).toBe(1)
  })

  it('deleteAccount clears the account-scoped localStorage keys', async () => {
    const a = await createAccount({ name: 'Alpha', starting_balance: 0 })
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

  it('countAccountData reports counts for every table the cascade touches', async () => {
    const a = await createAccount({ name: 'Alpha', starting_balance: 0 })
    await createTrade(tradeDraft(), a.id)
    await createTrade(tradeDraft(), a.id)
    await createAdjustment(adjustmentDraft(), a.id)
    await db.days.put({
      id: `${a.id}:2026-04-15`,
      account_id: a.id,
      date: '2026-04-15',
      screenshots: [],
      note: 'rough day',
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    })
    await db.models.put({
      id: 'm1',
      account_id: a.id,
      name: 'breakout',
      description: '',
      sessions: [],
      groups: [],
      draft: false,
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    })
    await db.symbols.put({
      id: 's1',
      account_id: a.id,
      name: 'NQ',
      description: '',
      point_value: 20,
      tick_size: 0.25,
      fee_per_side: 2.25,
      scratch_handles: 4,
      draft: false,
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    })
    await db.progress_rules.put({
      id: 'pr1',
      account_id: a.id,
      text: 'check the news',
      periods: [{ from: '2026-04-15', until: null }],
      sort: 0,
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    })
    await db.progress_checks.put({
      id: `${a.id}:2026-04-15:pr1`,
      account_id: a.id,
      date: '2026-04-15',
      rule_id: 'pr1',
      checked: true,
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    })
    await createTrade(tradeDraft(), MAIN_ACCOUNT_ID)

    expect(await countAccountData(a.id)).toEqual({
      trades: 2,
      adjustments: 1,
      days: 1,
      models: 1,
      symbols: 1,
      progressRules: 1,
      progressChecks: 1,
    })
    expect(await countAccountData(MAIN_ACCOUNT_ID)).toEqual({
      trades: 1,
      adjustments: 0,
      days: 0,
      models: 0,
      symbols: 0,
      progressRules: 0,
      progressChecks: 0,
    })
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

  describe('addPendingDayScreenshot', () => {
    it('writes the pending blob and the day ref atomically', async () => {
      const pending = {
        id: 'p1',
        account_id: ACCT,
        blob: new Blob(['x'], { type: 'image/png' }),
        filename: '01-jan-2026-thu-01.png',
        month_key: '2026-01',
        created_at: new Date().toISOString(),
      }
      const day = await addPendingDayScreenshot(ACCT, DATE, pending)
      // Day row carries the pending ref…
      expect(day.screenshots).toEqual(['pending:p1'])
      // …and the blob row exists, both committed together.
      expect(await db.pending_uploads.get('p1')).toMatchObject({ id: 'p1', account_id: ACCT })
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

  describe('setDayReflection', () => {
    it('creates the row when one does not exist', async () => {
      await setDayReflection(ACCT, DATE, { hardest_moment: 'the 10:32 rip' })
      expect(await getDayReflection(ACCT, DATE)).toEqual({
        hardest_moment: 'the 10:32 rip',
        wanted_to: '',
        instead_did: '',
      })
    })

    it('does not create a row when every field is blank', async () => {
      await setDayReflection(ACCT, DATE, { hardest_moment: '  ', wanted_to: '' })
      expect(await getDay(ACCT, DATE)).toBeUndefined()
    })

    it('patches one field without clobbering the others', async () => {
      // The UI persists per line on blur, so a single-key patch must leave the
      // other two lines exactly as they were.
      await setDayReflection(ACCT, DATE, { hardest_moment: 'a', wanted_to: 'b' })
      await setDayReflection(ACCT, DATE, { instead_did: 'c' })
      expect(await getDayReflection(ACCT, DATE)).toEqual({
        hardest_moment: 'a',
        wanted_to: 'b',
        instead_did: 'c',
      })
    })

    it('trims stored values', async () => {
      await setDayReflection(ACCT, DATE, { wanted_to: '  chase it  ' })
      expect((await getDayReflection(ACCT, DATE)).wanted_to).toBe('chase it')
    })

    it('clears a field while preserving the row when another survives', async () => {
      await setDayReflection(ACCT, DATE, { hardest_moment: 'a', wanted_to: 'b' })
      await setDayReflection(ACCT, DATE, { hardest_moment: '' })
      const day = await getDay(ACCT, DATE)
      expect(day?.hardest_moment).toBeUndefined()
      expect(day?.wanted_to).toBe('b')
    })

    it('deletes the row once the last reflection field is cleared', async () => {
      await setDayReflection(ACCT, DATE, { instead_did: 'sat out' })
      await setDayReflection(ACCT, DATE, { instead_did: '' })
      expect(await getDay(ACCT, DATE)).toBeUndefined()
    })

    // The regression that would silently destroy journal entries: a day whose
    // ONLY content is the reflection must survive every empty-row collector.
    it('keeps a reflection-only row when a screenshot is removed', async () => {
      await setDayReflection(ACCT, DATE, { hardest_moment: 'the 10:32 rip' })
      await addDayScreenshot(ACCT, DATE, 'drive:a')
      await removeDayScreenshot(ACCT, DATE, 'drive:a')
      const day = await getDay(ACCT, DATE)
      expect(day?.hardest_moment).toBe('the 10:32 rip')
    })

    it('keeps a reflection-only row when the note is cleared', async () => {
      await setDayReflection(ACCT, DATE, { wanted_to: 'chase it' })
      await setDayNote(ACCT, DATE, 'a thought')
      await setDayNote(ACCT, DATE, '')
      expect((await getDayReflection(ACCT, DATE)).wanted_to).toBe('chase it')
    })

    it('reads as empty strings for a day with no row at all', async () => {
      expect(await getDayReflection(ACCT, DATE)).toEqual({
        hardest_moment: '',
        wanted_to: '',
        instead_did: '',
      })
    })

    it('concurrent per-field writes do not clobber each other', async () => {
      // Tabbing quickly through the three lines fires three blurs in flight at
      // once. Each patch re-reads the row inside its own transaction, so they
      // must compose rather than the last one winning with two stale fields.
      await Promise.all([
        setDayReflection(ACCT, DATE, { hardest_moment: 'A' }),
        setDayReflection(ACCT, DATE, { wanted_to: 'B' }),
        setDayReflection(ACCT, DATE, { instead_did: 'C' }),
      ])
      expect(await getDayReflection(ACCT, DATE)).toEqual({
        hardest_moment: 'A',
        wanted_to: 'B',
        instead_did: 'C',
      })
    })

    it('leaves a PNL override intact when the reflection is cleared', async () => {
      await setDayPnlOverride(ACCT, DATE, -250)
      await setDayReflection(ACCT, DATE, { hardest_moment: 'tilted' })
      await setDayReflection(ACCT, DATE, { hardest_moment: '' })
      expect(await getDayPnlOverride(ACCT, DATE)).toBe(-250)
    })

    it('bumps updated_at so the sync layer sees the change', async () => {
      await setDayReflection(ACCT, DATE, { hardest_moment: 'A' })
      const first = (await getDay(ACCT, DATE))!.updated_at
      await new Promise(r => setTimeout(r, 3))
      await setDayReflection(ACCT, DATE, { hardest_moment: 'B' })
      expect((await getDay(ACCT, DATE))!.updated_at > first).toBe(true)
    })

    it('preserves interior whitespace and newlines, trimming only the ends', async () => {
      // The answers are textareas, so Enter is a real newline the user meant.
      await setDayReflection(ACCT, DATE, { instead_did: '  one\ntwo  b  \n ' })
      expect((await getDayReflection(ACCT, DATE)).instead_did).toBe('one\ntwo  b')
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
    await createAccount({ name: 'Alpha', starting_balance: 0 })
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
      draft: false,
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
    await createAccount({ name: 'Alt', starting_balance: 0 })
    const altId = (await listAccounts()).find(a => a.name === 'Alt')!.id
    await createTrade(tradeDraft({ model_id: 'shared' }))
    await createTrade(tradeDraft({ model_id: 'shared' }), altId)
    expect(await countTradesUsingModel(MAIN_ACCOUNT_ID, 'shared')).toBe(1)
    expect(await countTradesUsingModel(altId, 'shared')).toBe(1)
  })
})
