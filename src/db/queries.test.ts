import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setActiveAccountId } from '@/lib/active-account'
import { db, ensureSeedAccount } from './schema'
import { nextWeekdayKey, nyToday } from '@/lib/tz'
import { tradingDayAfter } from '@/lib/progress-periods'
import {
  addDayScreenshot,
  addPendingDayScreenshot,
  cloneAccount,
  countAccountData,
  countTradesUsingModel,
  createAccount,
  createModel,
  deleteModel,
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
  setDayNote,
  setDayFeesOverride,
  setDayPnlOverride,
  slugifyAccountName,
  updateAccountLossLimit,
  updateAccountScratchPct,
  updateModel,
  updateTrade,
} from './queries'
import { SEED_ACCOUNT_ID } from './types'
import { readSymbolFilterCache } from '@/lib/symbol-filter-cache'
import { setDefaultRangeWeeks } from '@/lib/default-range-preference'
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
  await ensureSeedAccount()
  setActiveAccountId(SEED_ACCOUNT_ID)
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
    expect(t.account_id).toBe(SEED_ACCOUNT_ID)
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
    expect(await listAllTrades(SEED_ACCOUNT_ID)).toHaveLength(3)
    expect(await listAllTrades('other-account')).toHaveLength(1)
  })
})

describe('weekend guard', () => {
  // 2026-04-18 is a Saturday, 2026-04-19 a Sunday; 2026-04-17 a Friday.
  it('createTrade rejects a weekend-dated trade', async () => {
    await expect(createTrade(tradeDraft({ date: '2026-04-18' }))).rejects.toThrow(/weekend/i)
    expect(await listAllTrades(SEED_ACCOUNT_ID)).toHaveLength(0)
  })

  it('createAdjustment rejects a weekend-dated deposit', async () => {
    await expect(createAdjustment(adjustmentDraft({ date: '2026-04-19' }))).rejects.toThrow(/weekend/i)
    expect(await listAdjustments(SEED_ACCOUNT_ID)).toHaveLength(0)
  })

  it('setDayPnlOverride rejects a weekend date', async () => {
    await expect(setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-18', -500)).rejects.toThrow(/weekend/i)
  })

  it('accepts a weekday date', async () => {
    await createTrade(tradeDraft({ date: '2026-04-17' }))
    expect(await listAllTrades(SEED_ACCOUNT_ID)).toHaveLength(1)
  })
})

describe('future guard', () => {
  it('createTrade accepts the next trading day but nothing later', async () => {
    const next = tradingDayAfter(nyToday())
    await createTrade(tradeDraft({ date: next }))
    await expect(createTrade(tradeDraft({ date: tradingDayAfter(next) }))).rejects.toThrow(/hasn't happened/)
    expect(await listAllTrades(SEED_ACCOUNT_ID)).toHaveLength(1)
  })
})

describe('day-override / trade mutual exclusion', () => {
  it('createTrade rejects a trade on a day that has a PNL override', async () => {
    await setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15', -1000)
    await expect(createTrade(tradeDraft({ date: '2026-04-15' }))).rejects.toThrow(/override/i)
    expect(await listAllTrades(SEED_ACCOUNT_ID)).toHaveLength(0)
  })

  it('updateTrade refuses to move a trade onto a day that has an override', async () => {
    // The create path is guarded above; the edit path can reach the same
    // contradictory state by changing an existing trade's date.
    const t = await createTrade(tradeDraft({ date: '2026-04-15' }))
    await setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-16', -100)
    await expect(updateTrade(t.id, { date: '2026-04-16' })).rejects.toThrow(/override/i)
  })

  it('createTrade allows trades on a different day than the override', async () => {
    await setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15', -1000)
    await createTrade(tradeDraft({ date: '2026-04-16' }))
    expect(await listAllTrades(SEED_ACCOUNT_ID)).toHaveLength(1)
  })

  it('setDayPnlOverride rejects an override on a day that has trades', async () => {
    await createTrade(tradeDraft({ date: '2026-04-15' }))
    await expect(setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15', -1000)).rejects.toThrow(/trade/i)
    expect(await getDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15')).toBeNull()
  })
})

describe('day fees override', () => {
  it('no-ops when the day has no PNL override (fees alone is meaningless)', async () => {
    await setDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15', 80)
    expect(await getDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15')).toBeNull()
    expect(await getDay(SEED_ACCOUNT_ID, '2026-04-15')).toBeUndefined()
  })

  it('stores fees on an override day and clearing the net drops the fees', async () => {
    await setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15', 295)
    await setDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15', 80)
    expect(await getDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15')).toBe(80)
    expect((await listDayOverrides(SEED_ACCOUNT_ID)).fees).toEqual(
      new Map([['2026-04-15', 80]]),
    )

    // Clearing the net override orphans the fees, so they're dropped too —
    // and the now-empty row is garbage-collected.
    await setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15', null)
    expect(await getDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15')).toBeNull()
    expect(await getDay(SEED_ACCOUNT_ID, '2026-04-15')).toBeUndefined()
  })

  it('stores the magnitude so a negative fee adds to the total, not subtracts', async () => {
    await setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15', 295)
    await setDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15', -80)
    expect(await getDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15')).toBe(80)
  })

  it('setDayFeesOverride(null) clears fees but keeps the net override', async () => {
    await setDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15', 295)
    await setDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15', 80)
    await setDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15', null)
    expect(await getDayFeesOverride(SEED_ACCOUNT_ID, '2026-04-15')).toBeNull()
    expect(await getDayPnlOverride(SEED_ACCOUNT_ID, '2026-04-15')).toBe(295)
  })
})

describe('adjustment queries', () => {
  it('createAdjustment assigns id + timestamps + active account', async () => {
    const a = await createAdjustment(adjustmentDraft())
    expect(a.id).toBeTruthy()
    expect(a.created_at).toBe(a.updated_at)
    expect(a.account_id).toBe(SEED_ACCOUNT_ID)
  })

  it('deleteAdjustment removes the record', async () => {
    const a = await createAdjustment(adjustmentDraft())
    await deleteAdjustment(a.id)
    expect(await listAdjustments(SEED_ACCOUNT_ID)).toHaveLength(0)
  })

  it('listAdjustments orders by date and scopes by account', async () => {
    await createAdjustment(adjustmentDraft({ date: '2026-04-20' }))
    await createAdjustment(adjustmentDraft({ date: '2026-04-01' }))
    await createAdjustment(adjustmentDraft({ date: '2026-04-10' }))
    await createAdjustment(adjustmentDraft({ date: '2026-04-06' }), 'other-account')
    const out = await listAdjustments(SEED_ACCOUNT_ID)
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

  it('produces the SEED_ACCOUNT_ID slug for "Test Account"', () => {
    expect(slugifyAccountName('Test Account')).toBe(SEED_ACCOUNT_ID)
  })
})

describe('account queries', () => {
  it('createAccount derives id from the name slug', async () => {
    const a = await createAccount({ name: 'Funded Challenge', starting_balance: 0 })
    expect(a.id).toBe('funded-challenge')
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

  it('createAccount rejects reusing the seeded account slug', async () => {
    await expect(createAccount({ name: 'Test Account', starting_balance: 0 })).rejects.toThrow(/collides/)
  })

  describe('updateAccountScratchPct', () => {
    const read = () => getAccount(SEED_ACCOUNT_ID)

    it('stores a non-default threshold and leaves the default absent', async () => {
      await updateAccountScratchPct(SEED_ACCOUNT_ID, 0.7)
      expect((await read())?.scratch_pct).toBe(0.7)
      await updateAccountScratchPct(SEED_ACCOUNT_ID, 0.4)
      expect(await read()).not.toHaveProperty('scratch_pct')
    })

    it('snaps slider float residue to tenths', async () => {
      await updateAccountScratchPct(SEED_ACCOUNT_ID, 0.1 + 0.2)
      expect((await read())?.scratch_pct).toBe(0.3)
    })

    it('rejects values outside 0.2–1.2 and leaves the row alone', async () => {
      await updateAccountScratchPct(SEED_ACCOUNT_ID, 0.9)
      for (const bad of [0.1, 1.3, Number.NaN]) {
        await expect(updateAccountScratchPct(SEED_ACCOUNT_ID, bad)).rejects.toThrow(/between/)
      }
      expect((await read())?.scratch_pct).toBe(0.9)
    })

    it('rejects a missing account', async () => {
      await expect(updateAccountScratchPct('nope', 0.5)).rejects.toThrow(/no longer exists/)
    })
  })

  describe('updateAccountLossLimit', () => {
    const full = { max_loss_usd: 2000, trailing: true, trail_stop_usd: 50_100 }
    const read = () => getAccount(SEED_ACCOUNT_ID)

    it('stores set values and leaves unset ones absent', async () => {
      await updateAccountLossLimit(SEED_ACCOUNT_ID, full)
      expect(await read()).toMatchObject(full)
      await updateAccountLossLimit(SEED_ACCOUNT_ID, { trail_stop_usd: null })
      const a = await read()
      expect(a).toMatchObject({ max_loss_usd: 2000, trailing: true })
      expect(a).not.toHaveProperty('trail_stop_usd')
    })

    it('merges into the stored row, not a stale snapshot', async () => {
      // Two quick edits, each sending only its own field: the second must not
      // write back the first's old value.
      await updateAccountLossLimit(SEED_ACCOUNT_ID, { max_loss_usd: 2000 })
      await Promise.all([
        updateAccountLossLimit(SEED_ACCOUNT_ID, { max_loss_usd: 2500 }),
        updateAccountLossLimit(SEED_ACCOUNT_ID, { trailing: true }),
      ])
      expect(await read()).toMatchObject({ max_loss_usd: 2500, trailing: true })
    })

    it('clearing the max loss clears the trailing rules with it', async () => {
      await updateAccountLossLimit(SEED_ACCOUNT_ID, full)
      await updateAccountLossLimit(SEED_ACCOUNT_ID, { max_loss_usd: null })
      const a = await read()
      expect(a).not.toHaveProperty('max_loss_usd')
      expect(a).not.toHaveProperty('trailing')
      expect(a).not.toHaveProperty('trail_stop_usd')
    })

    it('switching to static clears the stop', async () => {
      await updateAccountLossLimit(SEED_ACCOUNT_ID, full)
      await updateAccountLossLimit(SEED_ACCOUNT_ID, { trailing: false })
      const a = await read()
      expect(a?.max_loss_usd).toBe(2000)
      expect(a).not.toHaveProperty('trailing')
      expect(a).not.toHaveProperty('trail_stop_usd')
    })

    it('rejects a max loss that is zero, negative or non-finite', async () => {
      for (const bad of [0, -5, Infinity]) {
        await expect(
          updateAccountLossLimit(SEED_ACCOUNT_ID, { max_loss_usd: bad }),
        ).rejects.toThrow(/Max loss/)
      }
    })

    it('rejects a stop below the starting limit, allows it at or above', async () => {
      await db.accounts.update(SEED_ACCOUNT_ID, { starting_balance: 50_000 })
      await updateAccountLossLimit(SEED_ACCOUNT_ID, { max_loss_usd: 2000, trailing: true })
      await expect(
        updateAccountLossLimit(SEED_ACCOUNT_ID, { trail_stop_usd: 47_999 }),
      ).rejects.toThrow(/at least \$48,000/)
      await updateAccountLossLimit(SEED_ACCOUNT_ID, { trail_stop_usd: 48_000 })
      expect((await read())?.trail_stop_usd).toBe(48_000)
    })

    it('a max loss that would lift the starting limit past the stop names the max loss', async () => {
      await db.accounts.update(SEED_ACCOUNT_ID, { starting_balance: 50_000 })
      await updateAccountLossLimit(SEED_ACCOUNT_ID, {
        max_loss_usd: 2000,
        trailing: true,
        trail_stop_usd: 48_000,
      })
      await expect(
        updateAccountLossLimit(SEED_ACCOUNT_ID, { max_loss_usd: 1500 }),
      ).rejects.toThrow('Max loss must be at least $2,000.00 while trailing stops at $48,000.00.')
      expect((await read())?.max_loss_usd).toBe(2000)
    })

    it('allows a stop of zero on an account logged from a $0 balance', async () => {
      // The seed account starts at 0: its starting limit is −2,000.
      await updateAccountLossLimit(SEED_ACCOUNT_ID, { ...full, trail_stop_usd: 0 })
      expect((await read())?.trail_stop_usd).toBe(0)
    })

    it('throws for an account that no longer exists', async () => {
      await expect(updateAccountLossLimit('gone', full)).rejects.toThrow(/no longer exists/)
    })
  })

  describe('cloneAccount', () => {
    // A source account carrying one of everything the clone touches, plus a
    // hidden rule and a trade that must NOT come along.
    async function seedSource() {
      const ts = '2026-01-02T00:00:00.000Z'
      await db.models.put({
        id: 'src-model',
        account_id: SEED_ACCOUNT_ID,
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
        },
        SEED_ACCOUNT_ID,
      )
      await db.progress_rules.bulkPut([
        {
          id: 'src-rule',
          account_id: SEED_ACCOUNT_ID,
          text: 'no trades before 9:45',
          periods: [{ from: '2026-01-02', until: null }],
          sort: 2,
          created_at: ts,
          updated_at: ts,
        },
        {
          id: 'src-hidden',
          account_id: SEED_ACCOUNT_ID,
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
        SEED_ACCOUNT_ID,
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
      expect(await listModels(SEED_ACCOUNT_ID)).toHaveLength(1)
      expect(await listSymbols(SEED_ACCOUNT_ID)).toHaveLength(1)
    })

    it('does not copy the loss-limit rules', async () => {
      await updateAccountLossLimit(SEED_ACCOUNT_ID, {
        max_loss_usd: 2000,
        trailing: true,
        trail_stop_usd: 50_100,
      })
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 50_000 }, SEED_ACCOUNT_ID)
      const a = await getAccount(clone.id)
      expect(a).not.toHaveProperty('max_loss_usd')
      expect(a).not.toHaveProperty('trailing')
      expect(a).not.toHaveProperty('trail_stop_usd')
    })

    it('cloned rules run from today, skipping hidden ones', async () => {
      await seedSource()
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, SEED_ACCOUNT_ID)
      const rules = await db.progress_rules.where('account_id').equals(clone.id).toArray()
      expect(rules).toHaveLength(1)
      expect(rules[0].text).toBe('no trades before 9:45')
      // None of the source's history: the rule starts fresh on the new account.
      expect(rules[0].periods).toEqual([{ from: nextWeekdayKey(nyToday()), until: null }])
      expect(rules[0].sort).toBe(2)
    })

    it('a rule planned for a later session keeps that start on the clone', async () => {
      const later = tradingDayAfter(nextWeekdayKey(nyToday()))
      await db.progress_rules.put({
        id: 'src-planned',
        account_id: SEED_ACCOUNT_ID,
        text: 'planned',
        periods: [{ from: later, until: null }],
        sort: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, SEED_ACCOUNT_ID)
      const [planned] = await db.progress_rules.where('account_id').equals(clone.id).toArray()
      expect(planned.periods).toEqual([{ from: later, until: null }])
    })

    it('a blank rule is not cloned', async () => {
      await db.progress_rules.put({
        id: 'src-blank',
        account_id: SEED_ACCOUNT_ID,
        text: '',
        periods: [{ from: '2026-01-02', until: null }],
        sort: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, SEED_ACCOUNT_ID)
      expect(await db.progress_rules.where('account_id').equals(clone.id).count()).toBe(0)
    })

    it('a cloned line runs from today', async () => {
      await db.progress_rules.put({
        id: 'src-line',
        account_id: SEED_ACCOUNT_ID,
        text: '',
        kind: 'line',
        periods: [{ from: '2026-01-02', until: null }],
        sort: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      // An archived line is skipped like any archived rule.
      await db.progress_rules.put({
        id: 'src-old-line',
        account_id: SEED_ACCOUNT_ID,
        text: '',
        kind: 'line',
        periods: [{ from: '2025-01-02', until: '2025-06-01' }],
        hidden: true,
        sort: 2,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, SEED_ACCOUNT_ID)
      const cloned = await db.progress_rules.where('account_id').equals(clone.id).toArray()
      expect(cloned).toHaveLength(1)
      const [line] = cloned
      expect(line.kind).toBe('line')
      expect(line.periods).toEqual([{ from: nextWeekdayKey(nyToday()), until: null }])
    })

    it('seeds the symbol filter cache so the clone paints its pills immediately', async () => {
      await seedSource()
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, SEED_ACCOUNT_ID)
      const cached = readSymbolFilterCache(clone.id)
      expect(cached?.map(s => s.name)).toEqual(['NQ'])
      // Same rows that landed in the table, not the source's.
      expect(cached?.[0].id).toBe((await listSymbols(clone.id))[0].id)
    })

    it('writes no cache entry when the source has no symbols', async () => {
      await db.symbols.clear()
      const clone = await cloneAccount({ name: 'Bare', starting_balance: 0 }, SEED_ACCOUNT_ID)
      // An empty cache reads the same as none, so writing one is a stray key.
      expect(readSymbolFilterCache(clone.id)).toBeUndefined()
    })

    it('takes the balance from the draft, not from the source account', async () => {
      await db.accounts.update(SEED_ACCOUNT_ID, { starting_balance: 25_000 })
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 50_000 }, SEED_ACCOUNT_ID)
      expect(clone.starting_balance).toBe(50_000)
      expect((await getAccount(SEED_ACCOUNT_ID))?.starting_balance).toBe(25_000)
    })

    it('copies no history', async () => {
      await seedSource()
      const clone = await cloneAccount({ name: 'Eval 2', starting_balance: 0 }, SEED_ACCOUNT_ID)
      const counts = await countAccountData(clone.id)
      expect(counts.trades).toBe(0)
      expect(counts.adjustments).toBe(0)
      expect(counts.days).toBe(0)
      expect(counts.progressChecks).toBe(0)
    })

    it('leaves nothing behind when the name is rejected', async () => {
      await seedSource()
      await expect(
        cloneAccount({ name: 'Test Account', starting_balance: 0 }, SEED_ACCOUNT_ID),
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

  it('listAccounts orders oldest-created first, not by name', async () => {
    await db.accounts.update(SEED_ACCOUNT_ID, { created_at: '2026-01-02T00:00:00.000Z' })
    const zulu = await createAccount({ name: 'Zulu', starting_balance: 0 })
    const alpha = await createAccount({ name: 'Alpha', starting_balance: 0 })
    await db.accounts.update(zulu.id, { created_at: '2026-01-01T00:00:00.000Z' })
    await db.accounts.update(alpha.id, { created_at: '2026-01-03T00:00:00.000Z' })
    const all = await listAccounts()
    expect(all.map(a => a.name)).toEqual(['Zulu', 'Test Account', 'Alpha'])
  })

  it('createTrade refuses to save a trade when no account is selected', async () => {
    setActiveAccountId('')
    await expect(createTrade(tradeDraft())).rejects.toThrow(/no account/i)
    expect(await db.trades.count()).toBe(0)
  })

  it('deleteAccount forgets the default date range, so a reused id starts fresh', async () => {
    const other = await createAccount({ name: 'Eval B', starting_balance: 0 })
    setDefaultRangeWeeks(other.id, 9)
    expect(localStorage.getItem(`logslate:default_range_weeks:${other.id}`)).toBe('9')
    await deleteAccount(other.id)
    expect(localStorage.getItem(`logslate:default_range_weeks:${other.id}`)).toBeNull()
  })

  it('deleteAccount refuses to remove the last remaining account', async () => {
    // Only the auto-seeded account exists at this point.
    await expect(deleteAccount(SEED_ACCOUNT_ID)).rejects.toThrow(/at least one/i)
  })

  it('deleteAccount allows removing the seeded account when other accounts exist', async () => {
    await createAccount({ name: 'Alpha', starting_balance: 0 })
    await deleteAccount(SEED_ACCOUNT_ID)
    const remaining = await listAccounts()
    expect(remaining.map(a => a.name)).toEqual(['Alpha'])
  })

  it('deleteAccount cascades to trades and adjustments', async () => {
    const a = await createAccount({ name: 'Alpha', starting_balance: 0 })
    await createTrade(tradeDraft(), a.id)
    await createTrade(tradeDraft(), a.id)
    await createTrade(tradeDraft(), SEED_ACCOUNT_ID)
    await createAdjustment(adjustmentDraft(), a.id)

    await deleteAccount(a.id)

    expect(await listAccounts()).toHaveLength(1) // only the seeded account
    expect(await listAllTrades(a.id)).toHaveLength(0)
    expect(await listAdjustments(a.id)).toHaveLength(0)
    expect(await listAllTrades(SEED_ACCOUNT_ID)).toHaveLength(1) // other account untouched
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
      id: `${SEED_ACCOUNT_ID}:2026-04-20`,
      account_id: SEED_ACCOUNT_ID,
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
      account_id: SEED_ACCOUNT_ID,
      blob: new Blob(['y']),
      filename: '20-apr-2026-y.png',
      month_key: '2026-04',
      created_at: now,
    })

    await deleteAccount(a.id)

    expect(await db.days.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.days.where('account_id').equals(SEED_ACCOUNT_ID).count()).toBe(1)
    expect(await db.pending_uploads.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.pending_uploads.where('account_id').equals(SEED_ACCOUNT_ID).count()).toBe(1)
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
      sort: 1,
      created_at: now,
      updated_at: now,
    })
    await db.models.put({
      id: 'm-seed',
      account_id: SEED_ACCOUNT_ID,
      name: 'Seed model',
      description: '',
      sessions: [],
      groups: [],
      draft: false,
      sort: 1,
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
      id: 'r-seed',
      account_id: SEED_ACCOUNT_ID,
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
      created_at: now,
      updated_at: now,
    })
    await db.progress_checks.put({
      id: `${SEED_ACCOUNT_ID}:2026-04-20:r-seed`,
      account_id: SEED_ACCOUNT_ID,
      date: '2026-04-20',
      rule_id: 'r-seed',
      created_at: now,
      updated_at: now,
    })

    await deleteAccount(a.id)

    expect(await db.models.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.models.where('account_id').equals(SEED_ACCOUNT_ID).count()).toBe(1)
    expect(await db.progress_rules.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.progress_rules.where('account_id').equals(SEED_ACCOUNT_ID).count()).toBe(1)
    expect(await db.progress_checks.where('account_id').equals(a.id).count()).toBe(0)
    expect(await db.progress_checks.where('account_id').equals(SEED_ACCOUNT_ID).count()).toBe(1)
  })

  it('deleteAccount clears the account-scoped localStorage keys', async () => {
    const a = await createAccount({ name: 'Alpha', starting_balance: 0 })
    localStorage.setItem(`logslate:equity_view_default:${a.id}`, 'candles')
    localStorage.setItem(
      `logslate:drive:screenshots_folder:${a.id}`,
      JSON.stringify({ id: 'folder123' }),
    )
    localStorage.setItem(`logslate:drive:month_folders:${a.id}`, '{"2026-04":"m1"}')
    // The seeded account's keys should survive.
    localStorage.setItem(`logslate:equity_view_default:${SEED_ACCOUNT_ID}`, 'curve')

    await deleteAccount(a.id)

    expect(localStorage.getItem(`logslate:equity_view_default:${a.id}`)).toBeNull()
    expect(localStorage.getItem(`logslate:drive:screenshots_folder:${a.id}`)).toBeNull()
    expect(localStorage.getItem(`logslate:drive:month_folders:${a.id}`)).toBeNull()
    expect(localStorage.getItem(`logslate:equity_view_default:${SEED_ACCOUNT_ID}`)).toBe('curve')
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
      sort: 1,
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
      sort: 1,
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
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    })
    await createTrade(tradeDraft(), SEED_ACCOUNT_ID)

    expect(await countAccountData(a.id)).toEqual({
      trades: 2,
      adjustments: 1,
      days: 1,
      models: 1,
      symbols: 1,
      progressRules: 1,
      progressChecks: 1,
    })
    expect(await countAccountData(SEED_ACCOUNT_ID)).toEqual({
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
  const ACCT = SEED_ACCOUNT_ID
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
})

describe('ensureSeedAccount', () => {
  it('creates a regular Test Account when the DB is empty', async () => {
    await db.accounts.clear()
    await ensureSeedAccount()
    const seeded = await db.accounts.get(SEED_ACCOUNT_ID)
    expect(seeded?.name).toBe('Test Account')
    expect(seeded).not.toHaveProperty('is_main')
  })

  it('is a no-op when the seeded account already exists (preserves the existing row)', async () => {
    await db.accounts.clear()
    await ensureSeedAccount()
    const first = await db.accounts.get(SEED_ACCOUNT_ID)
    await new Promise(r => setTimeout(r, 2))
    await ensureSeedAccount()
    const second = await db.accounts.get(SEED_ACCOUNT_ID)
    expect(second?.created_at).toBe(first?.created_at)
    expect(second?.updated_at).toBe(first?.updated_at)
  })

  it('does not resurrect the seeded account once the user deleted it', async () => {
    await createAccount({ name: 'Alpha', starting_balance: 0 })
    await db.accounts.delete(SEED_ACCOUNT_ID)
    await ensureSeedAccount()
    const all = await listAccounts()
    expect(all.map(a => a.name)).toEqual(['Alpha'])
  })
})

describe('symbol queries', () => {
  const draft = (name: string) => ({
    name,
    description: '',
    point_value: 20,
    tick_size: 0.25,
    fee_per_side: 2.25,
    scratch_handles: 4,
    draft: false,
  })

  it('createSymbol puts a new symbol below every existing one', async () => {
    await createSymbol(draft('b'), SEED_ACCOUNT_ID)
    await createSymbol(draft('a'), SEED_ACCOUNT_ID)
    await createSymbol(draft('other'), 'other-account')
    const rows = await listSymbols(SEED_ACCOUNT_ID)
    expect(rows.map(r => r.name)).toEqual(['b', 'a'])
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
      account_id: opts.accountId ?? SEED_ACCOUNT_ID,
      name,
      description: '',
      sessions: [],
      groups: [],
      draft: false,
      sort: opts.sort ?? 1,
      created_at: ts,
      updated_at: ts,
    })
  }

  it('createModel puts a new model below every existing one', async () => {
    await putModel('m1', 'zeta', { sort: 4 })
    const m = await createModel(SEED_ACCOUNT_ID, { name: 'alpha', groups: [] })
    expect(m.sort).toBe(5)
    expect((await listModels(SEED_ACCOUNT_ID)).map(r => r.name)).toEqual(['zeta', 'alpha'])
  })

  it('updateModel patches fields and bumps updated_at; deleteModel removes the row', async () => {
    await putModel('m1', 'zeta')
    const before = (await db.models.get('m1'))!.updated_at
    await new Promise(r => setTimeout(r, 2))
    await updateModel('m1', { name: 'eta', description: 'd' })
    const after = (await db.models.get('m1'))!
    expect(after).toMatchObject({ name: 'eta', description: 'd', sort: 1 })
    expect(after.updated_at > before).toBe(true)
    await deleteModel('m1')
    expect(await db.models.get('m1')).toBeUndefined()
  })

  it('listModels breaks a sort tie alphabetically (case-insensitive)', async () => {
    await putModel('m1', 'beta')
    await putModel('m2', 'Alpha')
    await putModel('m3', 'gamma', { accountId: 'other-account' })
    const rows = await listModels(SEED_ACCOUNT_ID)
    expect(rows.map(m => m.name)).toEqual(['Alpha', 'beta'])
  })

  it('listModels respects the user-set sort order', async () => {
    await putModel('m1', 'beta', { sort: 2 })
    await putModel('m2', 'Alpha', { sort: 3 })
    await putModel('m3', 'gamma', { sort: 1 })
    const rows = await listModels(SEED_ACCOUNT_ID)
    expect(rows.map(m => m.name)).toEqual(['gamma', 'beta', 'Alpha'])
  })

  it('reorderModels assigns 1..N to each id in the supplied order', async () => {
    await putModel('m1', 'first')
    await putModel('m2', 'second')
    await putModel('m3', 'third')
    await reorderModels(['m3', 'm1', 'm2'])
    const rows = await listModels(SEED_ACCOUNT_ID)
    expect(rows.map(m => m.id)).toEqual(['m3', 'm1', 'm2'])
    expect(rows.map(m => m.sort)).toEqual([1, 2, 3])
  })

  it('reorderModels bumps updated_at on every renumbered row', async () => {
    await putModel('m1', 'a')
    await putModel('m2', 'b')
    const before = await listModels(SEED_ACCOUNT_ID)
    await new Promise(r => setTimeout(r, 5))
    await reorderModels(['m2', 'm1'])
    const after = await listModels(SEED_ACCOUNT_ID)
    for (const m of after) {
      const prev = before.find(b => b.id === m.id)!
      expect(m.updated_at > prev.updated_at).toBe(true)
    }
  })

  it('reorderModels is a no-op for an empty list', async () => {
    await putModel('m1', 'unchanged', { sort: 7 })
    await reorderModels([])
    const rows = await listModels(SEED_ACCOUNT_ID)
    expect(rows[0].sort).toBe(7)
  })

  it('listModels returns an empty array when the account has no models', async () => {
    const rows = await listModels(SEED_ACCOUNT_ID)
    expect(rows).toEqual([])
  })

  it('countTradesUsingModel hits the [account_id+model_id] index', async () => {
    await putModel('m-target', 'target')
    await createTrade(tradeDraft({ model_id: 'm-target' }))
    await createTrade(tradeDraft({ model_id: 'm-target' }))
    await createTrade(tradeDraft({ model_id: 'm-other' }))
    await createTrade(tradeDraft({ model_id: null }))
    expect(await countTradesUsingModel(SEED_ACCOUNT_ID, 'm-target')).toBe(2)
    expect(await countTradesUsingModel(SEED_ACCOUNT_ID, 'm-other')).toBe(1)
    expect(await countTradesUsingModel(SEED_ACCOUNT_ID, 'm-missing')).toBe(0)
  })

  it('countTradesUsingModel scopes by account', async () => {
    await createAccount({ name: 'Alt', starting_balance: 0 })
    const altId = (await listAccounts()).find(a => a.name === 'Alt')!.id
    await createTrade(tradeDraft({ model_id: 'shared' }))
    await createTrade(tradeDraft({ model_id: 'shared' }), altId)
    expect(await countTradesUsingModel(SEED_ACCOUNT_ID, 'shared')).toBe(1)
    expect(await countTradesUsingModel(altId, 'shared')).toBe(1)
  })
})
