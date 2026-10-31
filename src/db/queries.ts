import { isWeekend, parseISO } from 'date-fns'
import { db, dayHasContent } from '@/db/schema'
import type {
  Account,
  AccountDraft,
  AdjustmentDraft,
  Day,
  EquityAdjustment,
  Model,
  ModelDraft,
  PendingUpload,
  ProgressRule,
  TradeDraft,
  TradeRecord,
  TradingSymbol,
  TradingSymbolDraft,
} from '@/db/types'
import { getActiveAccountId } from '@/lib/active-account'
import { clearSymbolFilterCache, writeSymbolFilterCache } from '@/lib/symbol-filter-cache'
import { clearLastActivityDate } from '@/lib/last-activity-cache'
import { clearDefaultEquityView } from '@/lib/equity-view-preference'
import { clearDriveFolderCaches, discardScreenshotRef } from '@/lib/drive-images'
import {
  closePeriod,
  openPeriod,
  restartFrom,
  ruleActiveOn,
  ruleHasHistoryBefore,
} from '@/lib/progress-periods'
import { nextWeekdayKey, nyToday } from '@/lib/tz'

function now(): string {
  return new Date().toISOString()
}

export function newId(): string {
  return crypto.randomUUID()
}

/** The `sort` that puts a new row below every existing one. */
function nextSort(rows: Array<{ sort: number }>): number {
  return rows.reduce((max, r) => Math.max(max, r.sort), 0) + 1
}

// logslate records no weekend-dated activity: the futures the user trades are
// closed Sat/Sun, deposits/withdrawals don't post then, and the equity chart's
// Daily timeframe omits weekend buckets — so a weekend-dated money row would
// make the D-curve diverge from the W/M/Q/Y zooms (which DO include it). The
// date pickers already strip weekends; this is the data-layer backstop for the
// paths a picker can't cover (hand-typed `?date=` URL, cross-device sync,
// backup import). `parseISO` of a date-only string is interpreted as local
// midnight, so the weekday is read off the calendar date itself.
function assertWeekday(date: string): void {
  if (isWeekend(parseISO(date))) {
    throw new Error(`${date} is a weekend — logslate only records weekday activity.`)
  }
}

// Accounts use a slug of their name as the id — so the same account name
// created independently on two devices lands on the same row and merges
// cleanly on sync, instead of showing up as two separate accounts.
export function slugifyAccountName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    // strip combining marks (accents) so "Äccount" → "account"
    .replace(/[̀-ͯ]/g, '')
    // collapse anything that isn't alphanumeric into a single hyphen
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ---------- trades ----------

export async function createTrade(draft: TradeDraft, accountId?: string): Promise<TradeRecord> {
  const acct = accountId ?? getActiveAccountId()
  assertWeekday(draft.date)
  // A day is logged EITHER as individual trades OR as one manual net-PNL
  // override — never both (the override would silently hide the trades). The
  // Day-page UI already hides the New-trade button on an override day; this
  // is the data-layer backstop so a hand-typed `/trade/new?date=` URL or a
  // stale tab can't create the contradictory state either.
  let rec!: TradeRecord
  await db.transaction('rw', db.days, db.trades, async () => {
    const day = await db.days.get(dayId(acct, draft.date))
    if (day && typeof day.pnl_override === 'number') {
      throw new Error(
        `${draft.date} has a day-level PNL override — clear it before logging trades for that day.`,
      )
    }
    const ts = now()
    rec = {
      ...draft,
      id: newId(),
      account_id: acct,
      created_at: ts,
      updated_at: ts,
    }
    await db.trades.add(rec)
  })
  return rec
}

export async function updateTrade(id: string, patch: Partial<TradeDraft>): Promise<void> {
  if (patch.date !== undefined) {
    assertWeekday(patch.date)
    const trade = await db.trades.get(id)
    if (trade) {
      const acct = trade.account_id
      await db.transaction('rw', db.days, db.trades, async () => {
        const day = await db.days.get(dayId(acct, patch.date!))
        if (day && typeof day.pnl_override === 'number') {
          throw new Error(
            `${patch.date} has a day-level PNL override — clear it before moving a trade to that day.`,
          )
        }
        await db.trades.update(id, { ...patch, updated_at: now() })
      })
      return
    }
  }
  await db.trades.update(id, { ...patch, updated_at: now() })
}

export async function deleteTrade(id: string): Promise<void> {
  await db.trades.delete(id)
}

export async function getTrade(id: string): Promise<TradeRecord | undefined> {
  return db.trades.get(id)
}

export async function listAllTrades(accountId: string): Promise<TradeRecord[]> {
  return db.trades
    .where('[account_id+date]')
    .between([accountId, ''], [accountId, '￿'], true, true)
    .toArray()
}

// Most recent trade date for an account, or null if it has no trades. Reads
// only the `[account_id+date]` index keys and stops at the newest one, so it
// never materializes the trade records the way `listAllTrades().toArray()`
// does (which structured-clones every row). Used to fill the default
// date-range window without waiting on the full trades load.
export async function getLastTradeDate(accountId: string): Promise<string | null> {
  const keys = await db.trades
    .where('[account_id+date]')
    .between([accountId, ''], [accountId, '￿'], true, true)
    .reverse()
    .limit(1)
    .keys()
  const first = keys[0] as unknown as [string, string] | undefined
  return first ? first[1] : null
}

// ---------- models ----------

// Canonical model list for an account — ordered by the user's manual
// `sort` (drag-and-drop in the Models sidebar), alphabetical on a tie.
// The sidebar / filter dropdowns / trade-form pickers all read this so
// they stay in sync with the user's chosen order.
export async function listModels(accountId: string): Promise<Model[]> {
  const rows = await db.models.where('account_id').equals(accountId).toArray()
  return rows.sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/** Add a model to the bottom of the account's list. */
export async function createModel(
  accountId: string,
  fields: Pick<Model, 'name' | 'groups'>,
): Promise<Model> {
  return db.transaction('rw', db.models, async () => {
    const ts = now()
    const rec: Model = {
      id: newId(),
      account_id: accountId,
      description: '',
      sessions: [],
      draft: false,
      ...fields,
      sort: nextSort(await db.models.where('account_id').equals(accountId).toArray()),
      created_at: ts,
      updated_at: ts,
    }
    await db.models.add(rec)
    return rec
  })
}

export async function updateModel(
  id: string,
  patch: Partial<ModelDraft>,
): Promise<void> {
  await db.models.update(id, { ...patch, updated_at: now() })
}

export async function deleteModel(id: string): Promise<void> {
  await db.models.delete(id)
}

// Persists the user's drag-and-drop order. Renumbers from 1..N in a
// single transaction so the stored values stay dense and the list reads
// the same way after reload.
export async function reorderModels(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return
  const ts = new Date().toISOString()
  await db.transaction('rw', db.models, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.models.update(orderedIds[i], { sort: i + 1, updated_at: ts })
    }
  })
}

// Count of trades on `accountId` that reference `modelId`. Used by the
// Models editor to gate destructive edits with an "in use" warning. Hits
// the `[account_id+model_id]` compound index directly.
export async function countTradesUsingModel(
  accountId: string,
  modelId: string,
): Promise<number> {
  return db.trades
    .where('[account_id+model_id]')
    .equals([accountId, modelId])
    .count()
}

// ---------- symbols ----------

// Canonical symbol list for an account — ordered by the user's manual `sort`
// (drag-and-drop in the Symbols sidebar), alphabetical on a tie. The sidebar,
// trade-form picker, and filter dropdowns all read this so they stay in sync.
export async function listSymbols(accountId: string): Promise<TradingSymbol[]> {
  const rows = await db.symbols.where('account_id').equals(accountId).toArray()
  return rows.sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export async function createSymbol(
  draft: TradingSymbolDraft,
  accountId?: string,
): Promise<TradingSymbol> {
  const account = accountId ?? getActiveAccountId()
  return db.transaction('rw', db.symbols, async () => {
    const ts = now()
    const rec: TradingSymbol = {
      ...draft,
      id: newId(),
      account_id: account,
      sort: nextSort(await db.symbols.where('account_id').equals(account).toArray()),
      created_at: ts,
      updated_at: ts,
    }
    await db.symbols.add(rec)
    return rec
  })
}

export async function updateSymbol(
  id: string,
  patch: Partial<TradingSymbolDraft>,
): Promise<void> {
  await db.symbols.update(id, { ...patch, updated_at: now() })
}

export async function deleteSymbol(id: string): Promise<void> {
  await db.symbols.delete(id)
}

// Persists the user's drag-and-drop order. Renumbers 1..N in one transaction
// so stored values stay dense. Mirrors `reorderModels`.
export async function reorderSymbols(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return
  const ts = now()
  await db.transaction('rw', db.symbols, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.symbols.update(orderedIds[i], { sort: i + 1, updated_at: ts })
    }
  })
}

// Count of trades on `accountId` that reference `symbolId`. Powers the "in use"
// note in the Symbols editor. Hits the `[account_id+symbol_id]` compound index.
export async function countTradesUsingSymbol(
  accountId: string,
  symbolId: string,
): Promise<number> {
  return db.trades
    .where('[account_id+symbol_id]')
    .equals([accountId, symbolId])
    .count()
}

// ---------- equity adjustments ----------

export async function createAdjustment(
  draft: AdjustmentDraft,
  accountId?: string,
): Promise<EquityAdjustment> {
  assertWeekday(draft.date)
  const ts = now()
  const rec: EquityAdjustment = {
    ...draft,
    id: newId(),
    account_id: accountId ?? getActiveAccountId(),
    created_at: ts,
    updated_at: ts,
  }
  await db.adjustments.add(rec)
  return rec
}

export async function deleteAdjustment(id: string): Promise<void> {
  await db.adjustments.delete(id)
}

export async function listAdjustments(accountId: string): Promise<EquityAdjustment[]> {
  return db.adjustments
    .where('[account_id+date]')
    .between([accountId, ''], [accountId, '￿'], true, true)
    .toArray()
}

// ---------- accounts ----------

export async function listAccounts(): Promise<Account[]> {
  const all = await db.accounts.toArray()
  // Main first, then alphabetical by name (stable).
  return all.sort((a, b) => {
    if (a.is_main && !b.is_main) return -1
    if (!a.is_main && b.is_main) return 1
    return a.name.localeCompare(b.name)
  })
}

export async function getAccount(id: string): Promise<Account | undefined> {
  return db.accounts.get(id)
}

// Shapes a draft into a row. Pure — the slug-collision check is deliberately
// NOT here: it's a read that has to happen inside whichever transaction does
// the insert, or it's just a guess that went stale before the write.
function newAccountRow(draft: AccountDraft): Account {
  const ts = now()
  const name = draft.name.trim()
  if (!name) throw new Error('Account name is required.')
  const id = slugifyAccountName(name)
  if (!id) throw new Error('Account name must contain letters or numbers.')
  const balance = draft.starting_balance
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error('Starting balance must be zero or a positive number.')
  }
  return {
    id,
    name,
    is_main: false,
    starting_balance: balance,
    created_at: ts,
    updated_at: ts,
  }
}

// `db.accounts.add` would reject a duplicate id on its own, but as a raw Dexie
// ConstraintError. Checking first — inside the caller's transaction, so the
// answer can't go stale before the insert — is what makes the message readable.
//
// It names the existing account because what collides is the SLUG, not the
// name: "Eval 1", "Eval-1" and "eval 1" all resolve to `eval-1`, so a bare
// "already exists" reads as a lie when the two names plainly differ.
async function assertSlugFree(id: string): Promise<void> {
  const existing = await db.accounts.get(id)
  if (existing) {
    throw new Error(`That name collides with the existing account "${existing.name}".`)
  }
}

export async function createAccount(draft: AccountDraft): Promise<Account> {
  const rec = newAccountRow(draft)
  await db.transaction('rw', db.accounts, async () => {
    await assertSlugFree(rec.id)
    await db.accounts.add(rec)
  })
  return rec
}

/**
 * Creates an account pre-loaded with another account's SETUP — its models,
 * symbols and progress rules. History (trades, adjustments, day notes,
 * progress checks) is never copied: the point is a fresh account that's
 * immediately usable, e.g. the next eval on the same playbook.
 *
 * Every copied row gets a fresh id. `models`, `symbols` and `progress_rules`
 * are single tables keyed on `&id`, so reusing the source ids would be a
 * primary-key collision rather than a copy.
 *
 * Reads and writes share ONE transaction across all four tables: a failure
 * part-way can't leave a new account sitting there with half the setup it was
 * cloned for, and the source is read as a single consistent snapshot rather
 * than four independently-timed queries.
 */
export async function cloneAccount(
  draft: AccountDraft,
  sourceAccountId: string,
): Promise<Account> {
  const rec = newAccountRow(draft)
  const seededSymbols = await db.transaction(
    'rw',
    [db.accounts, db.models, db.symbols, db.progress_rules],
    async () => {
      await assertSlugFree(rec.id)
      if (!(await db.accounts.get(sourceAccountId))) {
        throw new Error('The account to copy from no longer exists.')
      }
      const [models, symbols, rules] = await Promise.all([
        listModels(sourceAccountId),
        listSymbols(sourceAccountId),
        db.progress_rules.where('account_id').equals(sourceAccountId).toArray(),
      ])
      const ts = rec.created_at
      const stamp = { account_id: rec.id, created_at: ts, updated_at: ts }

      const clonedModels: Model[] = models.map(m => ({
        ...m,
        ...stamp,
        id: newId(),
        // Group ids are embedded in the row rather than keyed in a table, so a
        // duplicate wouldn't break anything — but they're used as React keys
        // and re-minting them is free.
        groups: m.groups.map(g => ({ ...g, id: newId() })),
      }))
      const clonedSymbols: TradingSymbol[] = symbols.map(s => ({
        ...s,
        ...stamp,
        id: newId(),
      }))
      // `periods` is the SOURCE account's activity history — copying it would
      // give the new account rules that claim to have been live for months,
      // counting days before it existed against its adherence denominator.
      // Cloned rules and lines run from today instead (Monday at the
      // weekend), as if just named there — or from the later session one
      // was planned for. Hidden rules are skipped: a soft-deleted rule exists
      // only to keep old checks honest, and a fresh account has none.
      const today = nyToday()
      // A blank rule isn't copied: Progress drops unnamed rules anyway.
      const clonedRules: ProgressRule[] = rules
        .filter(r => r.hidden !== true && (r.kind === 'line' || r.text.trim() !== ''))
        .map(r =>
          unhidden({
            ...r,
            ...stamp,
            id: newId(),
            periods: [{ from: restartFrom(r, today), until: null }],
          }),
        )

      await db.accounts.add(rec)
      if (clonedModels.length > 0) await db.models.bulkAdd(clonedModels)
      if (clonedSymbols.length > 0) await db.symbols.bulkAdd(clonedSymbols)
      if (clonedRules.length > 0) await db.progress_rules.bulkAdd(clonedRules)
      return clonedSymbols
    },
  )
  // Seed the filter bar's first-paint cache from symbols we already hold — the
  // mirror of `deleteAccount` clearing it. Without this the Symbol pills on a
  // freshly cloned account flash "All" alone on the first reload, even though
  // the symbols were copied a moment ago. Outside the transaction on purpose:
  // a localStorage write must not be able to fail the DB work, and if the
  // transaction threw we never get here to cache an account that doesn't
  // exist. Nothing to seed for a source with no symbols — an empty cache reads
  // the same as none, so writing one is just a stray key.
  if (seededSymbols.length > 0) {
    writeSymbolFilterCache(rec.id, seededSymbols.map(({ id, name, draft }) => ({ id, name, draft })))
  }
  return rec
}

// Cascading delete: the account's trades, adjustments, day screenshots and
// queued uploads go with it, plus any per-account localStorage preferences /
// Drive folder caches. Refuses to delete the last remaining account so the
// app always has somewhere to land on next reload.
export async function deleteAccount(id: string): Promise<void> {
  const total = await db.accounts.count()
  if (total <= 1) throw new Error('At least one account must remain.')
  let screenshotRefs: string[] = []
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.trades,
      db.adjustments,
      db.days,
      db.pending_uploads,
      db.models,
      db.symbols,
      db.progress_rules,
      db.progress_checks,
    ],
    async () => {
      await db.trades.where('account_id').equals(id).delete()
      await db.adjustments.where('account_id').equals(id).delete()
      const days = await db.days.where('account_id').equals(id).toArray()
      screenshotRefs = days.flatMap(d => d.screenshots)
      await db.days.where('account_id').equals(id).delete()
      await db.pending_uploads.where('account_id').equals(id).delete()
      await db.models.where('account_id').equals(id).delete()
      await db.symbols.where('account_id').equals(id).delete()
      await db.progress_rules.where('account_id').equals(id).delete()
      await db.progress_checks.where('account_id').equals(id).delete()
      await db.accounts.delete(id)
    },
  )
  // Clear per-account preferences and caches so a later account that happens
  // to reuse this id doesn't inherit the old state.
  clearDefaultEquityView(id)
  clearDriveFolderCaches(id)
  clearSymbolFilterCache(id)
  clearLastActivityDate(id)
  // The day rows are gone, so their Drive files would be unreachable. Not
  // awaited: deletes that can't run now (signed out, offline) are queued.
  void Promise.all(screenshotRefs.map(discardScreenshotRef))
}

// Counts the data an account owns — used by the UI confirm dialog before a
// cascading delete so the user sees what's about to go. Mirrors every
// table touched by `deleteAccount`'s cascade.
export async function countAccountData(id: string): Promise<{
  trades: number
  adjustments: number
  days: number
  models: number
  symbols: number
  progressRules: number
  progressChecks: number
}> {
  const [trades, adjustments, days, models, symbols, progressRules, progressChecks] =
    await Promise.all([
      db.trades.where('account_id').equals(id).count(),
      db.adjustments.where('account_id').equals(id).count(),
      db.days.where('account_id').equals(id).count(),
      db.models.where('account_id').equals(id).count(),
      db.symbols.where('account_id').equals(id).count(),
      db.progress_rules.where('account_id').equals(id).count(),
      db.progress_checks.where('account_id').equals(id).count(),
    ])
  return { trades, adjustments, days, models, symbols, progressRules, progressChecks }
}

// ---------- days ----------

// One Day row per (account, date), id derived as `${account_id}:${date}` so
// the row converges naturally on sync. `screenshots[]` is multi-entry indexed
// (`*screenshots` in the schema string) so the pending-upload drainer can
// rewrite refs in place.

function dayId(accountId: string, date: string): string {
  return `${accountId}:${date}`
}

export async function getDay(
  accountId: string,
  date: string,
): Promise<Day | undefined> {
  return db.days.get(dayId(accountId, date))
}

export async function listDayScreenshotsFor(
  accountId: string,
  date: string,
): Promise<string[]> {
  const day = await getDay(accountId, date)
  return day?.screenshots ?? []
}

// Appends a screenshot ref to a day's list, creating the day row if it
// doesn't exist yet. MUST run inside a `rw` transaction that includes
// `db.days`.
async function appendDayScreenshotTx(
  accountId: string,
  date: string,
  screenshot: string,
  ts: string,
): Promise<Day> {
  const id = dayId(accountId, date)
  const existing = await db.days.get(id)
  const next: Day = existing
    ? {
        ...existing,
        screenshots: [...existing.screenshots, screenshot],
        updated_at: ts,
      }
    : {
        id,
        account_id: accountId,
        date,
        screenshots: [screenshot],
        created_at: ts,
        updated_at: ts,
      }
  await db.days.put(next)
  return next
}

export async function addDayScreenshot(
  accountId: string,
  date: string,
  screenshot: string,
): Promise<Day> {
  const ts = now()
  return db.transaction('rw', db.days, () =>
    appendDayScreenshotTx(accountId, date, screenshot, ts),
  )
}

// Atomically queues a screenshot blob for later Drive upload AND attaches
// its `pending:` ref to the day — both in one transaction. If the app dies
// between the two writes (e.g. Android tab eviction), there is no window
// where the blob exists without its ref, or the ref without its blob.
export async function addPendingDayScreenshot(
  accountId: string,
  date: string,
  pending: PendingUpload,
): Promise<Day> {
  const ts = now()
  return db.transaction('rw', db.days, db.pending_uploads, async () => {
    await db.pending_uploads.add(pending)
    return appendDayScreenshotTx(accountId, date, `pending:${pending.id}`, ts)
  })
}

export async function removeDayScreenshot(
  accountId: string,
  date: string,
  screenshot: string,
): Promise<void> {
  const id = dayId(accountId, date)
  const ts = now()
  await db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(id)
    if (!existing) return
    const screenshots = existing.screenshots.filter(s => s !== screenshot)
    const next: Day = { ...existing, screenshots, updated_at: ts }
    if (!dayHasContent(next)) {
      // No remaining content on this day — drop the row instead of leaving
      // an empty placeholder.
      await db.days.delete(id)
      return
    }
    await db.days.put(next)
  })
}

export async function getDayNote(
  accountId: string,
  date: string,
): Promise<string> {
  const day = await getDay(accountId, date)
  return day?.note ?? ''
}

export async function getDayPnlOverride(
  accountId: string,
  date: string,
): Promise<number | null> {
  const day = await getDay(accountId, date)
  return day?.pnl_override ?? null
}

/** Both day-level override maps from ONE scan of the days table: two queries
 *  would mean the same `where('account_id')` scan — and a full structured
 *  clone of every day row, notes included — twice, both on the critical path
 *  of the default date-range window. Overrides are rare (one per tilt/revenge day) so
 *  filtering in memory still beats a dedicated index. */
export async function listDayOverrides(
  accountId: string,
): Promise<{ pnl: Map<string, number>; fees: Map<string, number> }> {
  const rows = await db.days.where('account_id').equals(accountId).toArray()
  const pnl = new Map<string, number>()
  const fees = new Map<string, number>()
  for (const d of rows) {
    if (typeof d.pnl_override === 'number') pnl.set(d.date, d.pnl_override)
    if (typeof d.fees_override === 'number') fees.set(d.date, d.fees_override)
  }
  return { pnl, fees }
}

/** All net-PNL overrides for an account as a `date → value` map. */
export async function listDayPnlOverrides(
  accountId: string,
): Promise<Map<string, number>> {
  return (await listDayOverrides(accountId)).pnl
}

/** Upserts the per-day net-PNL override. Passing `null` clears it; if the
 *  row then has no other content the whole row is removed so the days
 *  table doesn't grow with empty rows. */
export async function setDayPnlOverride(
  accountId: string,
  date: string,
  value: number | null,
): Promise<void> {
  const id = dayId(accountId, date)
  const ts = now()
  await db.transaction('rw', db.days, db.trades, async () => {
    // Mutual exclusion (the override side): a day with logged trades can't
    // also carry a net-PNL override — the override would hide them.
    if (value != null) {
      assertWeekday(date)
      const tradeCount = await db.trades
        .where('[account_id+date]')
        .equals([accountId, date])
        .count()
      if (tradeCount > 0) {
        throw new Error(
          `${date} has ${tradeCount} logged trade${tradeCount === 1 ? '' : 's'} — ` +
            `a day-level PNL override replaces trades, so remove them first.`,
        )
      }
    }
    const existing = await db.days.get(id)
    if (!existing) {
      if (value == null) return
      await db.days.put({
        id,
        account_id: accountId,
        date,
        screenshots: [],
        pnl_override: value,
        created_at: ts,
        updated_at: ts,
      })
      return
    }
    const next: Day = { ...existing, updated_at: ts }
    if (value == null) {
      // Fees are informational about the net override; clearing the net
      // orphans them, so drop fees_override whenever the override is cleared.
      delete next.pnl_override
      delete next.fees_override
    } else {
      next.pnl_override = value
    }
    if (!dayHasContent(next)) {
      await db.days.delete(id)
      return
    }
    await db.days.put(next)
  })
}

export async function getDayFeesOverride(
  accountId: string,
  date: string,
): Promise<number | null> {
  const day = await getDay(accountId, date)
  return day?.fees_override ?? null
}

/** Sets the informational fees figure for an override day. No-op unless the
 *  day already carries a `pnl_override` (fees alone is meaningless). Passing
 *  `null` clears it. Never touches net or equity. Fees are a cost, so the
 *  magnitude is stored regardless of sign — a negative entry would otherwise
 *  subtract from the fees total instead of adding to it. */
export async function setDayFeesOverride(
  accountId: string,
  date: string,
  value: number | null,
): Promise<void> {
  const id = dayId(accountId, date)
  const ts = now()
  await db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(id)
    // Fees are meaningless without a net override to attribute them to.
    if (!existing || typeof existing.pnl_override !== 'number') return
    const next: Day = { ...existing, updated_at: ts }
    if (value == null) delete next.fees_override
    else next.fees_override = Math.abs(value)
    await db.days.put(next)
  })
}

/** Upserts the per-day journal note. Empty/whitespace strings clear the
 *  field; if the row has no other content (no screenshots, no note) the
 *  whole row is removed so the days table doesn't grow with empty rows. */
export async function setDayNote(
  accountId: string,
  date: string,
  note: string,
): Promise<void> {
  const id = dayId(accountId, date)
  const ts = now()
  const trimmed = note.trim().length === 0 ? '' : note
  await db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(id)
    if (!existing) {
      if (trimmed === '') return
      await db.days.put({
        id,
        account_id: accountId,
        date,
        screenshots: [],
        note: trimmed,
        created_at: ts,
        updated_at: ts,
      })
      return
    }
    const next: Day = { ...existing, updated_at: ts }
    if (trimmed === '') delete next.note
    else next.note = trimmed
    if (!dayHasContent(next)) {
      await db.days.delete(id)
      return
    }
    await db.days.put(next)
  })
}

// --- Progress rules -------------------------------------------------------

// A tick only means anything on a day the rule was actually in force: the
// checklist shows the rules active on the day, and the heat strip counts a
// day's ticks against that same set. A row on any other day is invisible
// everywhere — residue that only grows the table.
//
// They appear whenever a period shrinks underneath a tick already made.
// Ticking a rule and then retiring it the same day is the ordinary way in:
// `closePeriod` ends the period yesterday (or drops it outright, if the rule
// never saw a trading day), and today's tick is left behind attached to
// nothing.
async function pruneOrphanChecks(rule: ProgressRule): Promise<void> {
  const orphans = await db.progress_checks
    .where('account_id')
    .equals(rule.account_id)
    .filter(c => c.rule_id === rule.id && !ruleActiveOn(rule, c.date))
    .primaryKeys()
  if (orphans.length > 0) await db.progress_checks.bulkDelete(orphans)
}

/** Add an empty rule to the end of the list. */
export async function createProgressRule(accountId: string): Promise<ProgressRule> {
  // No periods: it starts when it's named (see `setProgressRuleText`), so a
  // blank row counts toward no day.
  return appendProgressRule(accountId, {})
}

/**
 * Add a line to the end of the list, running from `date` — the day on
 * screen, as a rule named there would. Planning the next session
 * doesn't draw it into today's checklist or any day behind it.
 */
export async function createProgressLine(
  accountId: string,
  date: string,
): Promise<ProgressRule> {
  return appendProgressRule(accountId, {
    kind: 'line',
    periods: [{ from: nextWeekdayKey(date), until: null }],
  })
}

/** The soft-delete flag is absent, never `false`: the rest of the app treats
 *  "absent" and "not hidden" alike. */
function unhidden(rule: ProgressRule): ProgressRule {
  const copy = { ...rule }
  delete copy.hidden
  return copy
}

// The sort value is read inside the transaction: two quick taps on "Add rule"
// both computed it from the same on-screen snapshot and landed on the same
// number.
async function appendProgressRule(
  accountId: string,
  fields: Partial<Pick<ProgressRule, 'kind' | 'periods'>>,
): Promise<ProgressRule> {
  return db.transaction('rw', db.progress_rules, async () => {
    const existing = await db.progress_rules.where('account_id').equals(accountId).toArray()
    const ts = now()
    const rule: ProgressRule = {
      id: newId(),
      account_id: accountId,
      text: '',
      periods: [],
      ...fields,
      sort: nextSort(existing),
      created_at: ts,
      updated_at: ts,
    }
    await db.progress_rules.put(rule)
    return rule
  })
}

/**
 * Bring an archived rule back, running again from `date`.
 *
 * Past periods are left exactly as they were, so the days it already scored
 * keep it and their adherence doesn't move — the rule simply resumes.
 */
export async function restoreProgressRule(ruleId: string, date: string): Promise<void> {
  await db.transaction('rw', db.progress_rules, async () => {
    const rule = await db.progress_rules.get(ruleId)
    if (!rule) return
    await db.progress_rules.put(
      unhidden({ ...rule, periods: openPeriod(rule, date), updated_at: now() }),
    )
  })
}

/**
 * Flip a rule's tick for a day, deciding from what is stored rather than from
 * what was on screen: on a double tap the live query hasn't come back between
 * the two, and reading the screen would write the tick twice.
 *
 * Unticking deletes the row outright: a stored row is a tick.
 */
export async function toggleProgressCheck(
  accountId: string,
  date: string,
  ruleId: string,
): Promise<boolean> {
  const id = `${accountId}:${date}:${ruleId}`
  return db.transaction('rw', db.progress_checks, async () => {
    if (await db.progress_checks.get(id)) {
      await db.progress_checks.delete(id)
      return false
    }
    const ts = now()
    await db.progress_checks.put({
      id,
      account_id: accountId,
      date,
      rule_id: ruleId,
      created_at: ts,
      updated_at: ts,
    })
    return true
  })
}

type ProgressRuleDeletion = 'deleted' | 'archived' | 'missing'

/** Delete a rule only if it's still blank and never ran — re-checked inside
 *  the transaction, so a name saved a moment earlier wins. */
export async function deleteBlankProgressRule(ruleId: string): Promise<void> {
  await db.transaction('rw', db.progress_rules, async () => {
    const rule = await db.progress_rules.get(ruleId)
    if (rule && rule.text === '' && rule.periods.length === 0 && rule.kind !== 'line') {
      await db.progress_rules.delete(ruleId)
    }
  })
}

/**
 * Remove a rule from `date` on.
 *
 * A rule no past day depends on is deleted outright. One that was in force on
 * any day behind us is hidden instead, keeping its periods and its ticks so
 * those days' adherence doesn't drift. Ticked or not makes no difference: an
 * unticked day still counted the rule in its total, so deleting such a rule
 * would raise those days' scores after the fact.
 *
 * All of it in one transaction: a write landing midway can't leave check rows
 * orphaned from a rule that is already gone.
 */
export async function deleteProgressRule(
  ruleId: string,
  date: string,
): Promise<ProgressRuleDeletion> {
  return db.transaction('rw', db.progress_rules, db.progress_checks, async () => {
    const rule = await db.progress_rules.get(ruleId)
    if (!rule) return 'missing'
    return retireRule(rule, date)
  })
}

// The body of `deleteProgressRule`, shared with `setProgressRuleText`. Must run
// inside a transaction over both progress tables.
async function retireRule(
  rule: ProgressRule,
  date: string,
): Promise<'deleted' | 'archived'> {
  const next: ProgressRule = {
    ...rule,
    periods: closePeriod(rule, date),
    updated_at: now(),
  }
  // With no period left, no day ever counted the rule — named and deleted
  // within one session, say — and the prune clears every tick it collected.
  await pruneOrphanChecks(next)
  if (next.periods.length === 0) {
    await db.progress_rules.delete(rule.id)
    return 'deleted'
  }
  await db.progress_rules.put({ ...next, hidden: true })
  return 'archived'
}

/**
 * Save the rule list's order after a drag. `orderedIds` is the visible
 * (unarchived) rules, top to bottom.
 *
 * Archived rules stay in the slots they already had: past days still list
 * them in their checklist, interleaved by `sort`, so renumbering only the
 * visible rules would shuffle those days' checklists around the archived
 * ones. Read inside the transaction, for the same reason `appendProgressRule`
 * is.
 */
export async function reorderProgressRules(
  accountId: string,
  orderedIds: string[],
): Promise<void> {
  await db.transaction('rw', db.progress_rules, async () => {
    const all = await db.progress_rules.where('account_id').equals(accountId).sortBy('sort')
    const moved = new Set(orderedIds)
    const queue = orderedIds.filter(id => all.some(r => r.id === id))
    const order = all.map(r => (moved.has(r.id) ? queue.shift() : r.id))
    const sortOf = new Map(all.map(r => [r.id, r.sort]))
    const ts = now()
    for (let i = 0; i < order.length; i++) {
      const id = order[i]
      // A rule deleted between the drag and this write leaves its slot empty.
      if (id === undefined) continue
      // Untouched rows keep their `updated_at`, so a sync doesn't re-send
      // every rule for a one-row move.
      if (sortOf.get(id) === i + 1) continue
      await db.progress_rules.update(id, { sort: i + 1, updated_at: ts })
    }
  })
}

type ProgressRuleTextChange = 'renamed' | 'replaced' | 'kept' | 'missing'

/**
 * Change a rule's words as of `date`, the day being viewed.
 *
 * A rule no past day has scored is simply renamed. One with history is
 * replaced: a past day's tick means "I did what these words said", and
 * rewording the rule underneath it would make the record say something else
 * — swapping the texts of two rules to reorder them turned "20 min prep" into
 * "3 trades max" on every day already journalled. So the old rule retires
 * from `date` exactly as deleting it would, and a new rule with the new words
 * takes its place in the list, starting `date` — or the later session the old
 * one was planned for.
 */
export async function setProgressRuleText(
  ruleId: string,
  date: string,
  text: string,
): Promise<ProgressRuleTextChange> {
  return db.transaction('rw', db.progress_rules, db.progress_checks, async () => {
    const rule = await db.progress_rules.get(ruleId)
    if (!rule) return 'missing'
    const blank = text.trim() === ''
    if (!ruleHasHistoryBefore(rule, date)) {
      // A new rule starts the first time it's named, from the day on screen,
      // and goes back to waiting if its name is cleared before any day
      // scored it, so a blank row counts toward no day.
      const next: ProgressRule = {
        ...rule,
        text: blank ? '' : text,
        periods: blank ? closePeriod(rule, date) : openPeriod(rule, date),
        updated_at: now(),
      }
      await db.progress_rules.put(next)
      if (blank) await pruneOrphanChecks(next)
      return 'renamed'
    }
    // Blanking it would replace it with an unnamed rule that scores, which
    // is never what clearing the field meant.
    if (blank) return 'kept'
    // The replacement starts where the old one retires, or keeps the later
    // session it was planned for: it inherits the plan, not just the words.
    const from = restartFrom(rule, date)
    const ts = now()
    await retireRule(rule, date)
    await db.progress_rules.put({
      id: newId(),
      account_id: rule.account_id,
      text,
      periods: [{ from, until: null }],
      sort: rule.sort,
      created_at: ts,
      updated_at: ts,
    })
    return 'replaced'
  })
}
