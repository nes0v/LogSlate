import { isWeekend, parseISO } from 'date-fns'
import { db, dayHasContent } from '@/db/schema'
import type {
  Account,
  AccountDraft,
  AdjustmentDraft,
  Day,
  EquityAdjustment,
  Model,
  PendingUpload,
  TradeDraft,
  TradeRecord,
  TradingSymbol,
  TradingSymbolDraft,
} from '@/db/types'
import { getActiveAccountId } from '@/lib/active-account'
import { clearSymbolFilterCache } from '@/lib/symbol-filter-cache'
import { clearLastActivityDate } from '@/lib/last-activity-cache'

function now(): string {
  return new Date().toISOString()
}

function newId(): string {
  return crypto.randomUUID()
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
// `sort` if set (drag-and-drop in the Models sidebar), with rows that
// have no sort value falling through to alphabetical at the bottom.
// The sidebar / filter dropdowns / trade-form pickers all read this so
// they stay in sync with the user's chosen order.
export async function listModels(accountId: string): Promise<Model[]> {
  const rows = await db.models.where('account_id').equals(accountId).toArray()
  return rows.sort((a, b) => {
    const sa = a.sort ?? Number.MAX_SAFE_INTEGER
    const sb = b.sort ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
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
// (drag-and-drop in the Symbols sidebar), with rows that have no sort value
// falling through to alphabetical at the bottom. The sidebar, trade-form
// picker, and filter dropdowns all read this so they stay in sync.
export async function listSymbols(accountId: string): Promise<TradingSymbol[]> {
  const rows = await db.symbols.where('account_id').equals(accountId).toArray()
  return rows.sort((a, b) => {
    const sa = a.sort ?? Number.MAX_SAFE_INTEGER
    const sb = b.sort ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export async function createSymbol(
  draft: TradingSymbolDraft,
  accountId?: string,
): Promise<TradingSymbol> {
  const ts = now()
  const rec: TradingSymbol = {
    ...draft,
    id: newId(),
    account_id: accountId ?? getActiveAccountId(),
    created_at: ts,
    updated_at: ts,
  }
  await db.symbols.add(rec)
  return rec
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

export async function updateAdjustment(
  id: string,
  patch: Partial<AdjustmentDraft>,
): Promise<void> {
  if (patch.date !== undefined) assertWeekday(patch.date)
  await db.adjustments.update(id, { ...patch, updated_at: now() })
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

export async function createAccount(draft: AccountDraft): Promise<Account> {
  const ts = now()
  const name = draft.name.trim()
  if (!name) throw new Error('Account name is required.')
  const id = slugifyAccountName(name)
  if (!id) throw new Error('Account name must contain letters or numbers.')
  const existing = await db.accounts.get(id)
  if (existing) throw new Error('An account with this name already exists.')
  const rec: Account = {
    id,
    name,
    is_main: false,
    created_at: ts,
    updated_at: ts,
  }
  await db.accounts.add(rec)
  return rec
}

// Cascading delete: the account's trades, adjustments, day screenshots and
// queued uploads go with it, plus any per-account localStorage preferences /
// Drive folder caches. Refuses to delete the last remaining account so the
// app always has somewhere to land on next reload.
export async function deleteAccount(id: string): Promise<void> {
  const total = await db.accounts.count()
  if (total <= 1) throw new Error('At least one account must remain.')
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
      await db.days.where('account_id').equals(id).delete()
      await db.pending_uploads.where('account_id').equals(id).delete()
      await db.models.where('account_id').equals(id).delete()
      await db.symbols.where('account_id').equals(id).delete()
      await db.progress_rules.where('account_id').equals(id).delete()
      await db.progress_checks.where('account_id').equals(id).delete()
      await db.accounts.delete(id)
    },
  )
  // Clear per-account preferences and Drive folder caches so a later account
  // that happens to reuse this id doesn't inherit the old state.
  try {
    localStorage.removeItem(`logslate:equity_view_default:${id}`)
    localStorage.removeItem(`logslate:drive:screenshots_folder:${id}`)
    localStorage.removeItem(`logslate:drive:month_folders:${id}`)
  } catch {
    // localStorage unavailable — keys will linger but are harmless.
  }
  clearSymbolFilterCache(id)
  clearLastActivityDate(id)
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

/** Both day-level override maps from ONE scan of the days table. The net and
 *  fees maps used to be two exported queries run side by side, which meant the
 *  same `where('account_id')` scan — and a full structured clone of every day
 *  row, notes included — twice, both on the critical path of the default
 *  date-range window. Overrides are rare (one per tilt/revenge day) so
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
    // also carry a net-PNL override — the override would hide them. Clearing
    // (value == null) is always allowed so a legacy both-day OR a legacy
    // weekend row can still be recovered.
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
    const next: Day = {
      ...existing,
      pnl_override: value ?? undefined,
      // Fees are informational about the net override; clearing the net
      // orphans them, so drop fees_override whenever the override is cleared.
      fees_override: value == null ? undefined : existing.fees_override,
      updated_at: ts,
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
    const next: Day = {
      ...existing,
      fees_override: value == null ? undefined : Math.abs(value),
      updated_at: ts,
    }
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
    const next: Day = {
      ...existing,
      note: trimmed === '' ? undefined : trimmed,
      updated_at: ts,
    }
    if (!dayHasContent(next)) {
      await db.days.delete(id)
      return
    }
    await db.days.put(next)
  })
}

/** The three reflection continuations for a day, `''` when unanswered — the
 *  same absent-reads-as-empty contract `getDayNote` uses, so the UI never has
 *  to distinguish "no row" from "row with no reflection". */
export interface DayReflection {
  hardest_moment: string
  wanted_to: string
  instead_did: string
}

export async function getDayReflection(
  accountId: string,
  date: string,
): Promise<DayReflection> {
  const day = await getDay(accountId, date)
  return {
    hardest_moment: day?.hardest_moment ?? '',
    wanted_to: day?.wanted_to ?? '',
    instead_did: day?.instead_did ?? '',
  }
}

/** Maps cleared fields to `undefined` so they're dropped from the row rather
 *  than stored as empty strings — `dayHasContent` tests truthiness, and a
 *  persisted `''` would read as content and keep dead rows alive forever. */
function blankToUndefined(patch: Partial<DayReflection>): Partial<DayReflection> {
  const out: Partial<DayReflection> = {}
  for (const [k, v] of Object.entries(patch) as Array<[keyof DayReflection, string]>) {
    const trimmed = v.trim()
    out[k] = trimmed === '' ? undefined : trimmed
  }
  return out
}

/** Upserts one or more reflection fields. Takes a patch rather than the whole
 *  set because the UI persists per-line on blur — writing all three would
 *  clobber a line the user is still editing. Same empty-row rules as
 *  `setDayNote`: blank clears the field, and a row left holding nothing at
 *  all is deleted rather than lingering as a placeholder. */
export async function setDayReflection(
  accountId: string,
  date: string,
  patch: Partial<DayReflection>,
): Promise<void> {
  const id = dayId(accountId, date)
  const ts = now()
  const fields = blankToUndefined(patch)
  await db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(id)
    if (!existing) {
      // Nothing to store and no row to update — don't create an empty one.
      if (Object.values(fields).every(v => v === undefined)) return
      await db.days.put({
        id,
        account_id: accountId,
        date,
        screenshots: [],
        ...fields,
        created_at: ts,
        updated_at: ts,
      })
      return
    }
    const next: Day = { ...existing, ...fields, updated_at: ts }
    if (!dayHasContent(next)) {
      await db.days.delete(id)
      return
    }
    await db.days.put(next)
  })
}
