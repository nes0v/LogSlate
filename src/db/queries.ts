import { db } from '@/db/schema'
import type {
  Account,
  AccountDraft,
  AdjustmentDraft,
  Day,
  EquityAdjustment,
  Model,
  TradeDraft,
  TradeRecord,
} from '@/db/types'
import { getActiveAccountId } from '@/lib/active-account'

function now(): string {
  return new Date().toISOString()
}

function newId(): string {
  return crypto.randomUUID()
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
  const ts = now()
  const rec: TradeRecord = {
    ...draft,
    id: newId(),
    account_id: accountId ?? getActiveAccountId(),
    created_at: ts,
    updated_at: ts,
  }
  await db.trades.add(rec)
  return rec
}

export async function updateTrade(id: string, patch: Partial<TradeDraft>): Promise<void> {
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

// ---------- equity adjustments ----------

export async function createAdjustment(
  draft: AdjustmentDraft,
  accountId?: string,
): Promise<EquityAdjustment> {
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
    [db.accounts, db.trades, db.adjustments, db.days, db.pending_uploads],
    async () => {
      await db.trades.where('account_id').equals(id).delete()
      await db.adjustments.where('account_id').equals(id).delete()
      await db.days.where('account_id').equals(id).delete()
      await db.pending_uploads.where('account_id').equals(id).delete()
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
}

// Counts the data an account owns — used by the UI confirm dialog before a
// cascading delete so the user sees what's about to go.
export async function countAccountData(
  id: string,
): Promise<{ trades: number; adjustments: number }> {
  const [trades, adjustments] = await Promise.all([
    db.trades.where('account_id').equals(id).count(),
    db.adjustments.where('account_id').equals(id).count(),
  ])
  return { trades, adjustments }
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

export async function addDayScreenshot(
  accountId: string,
  date: string,
  screenshot: string,
): Promise<Day> {
  const id = dayId(accountId, date)
  const ts = now()
  return db.transaction('rw', db.days, async () => {
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
    if (screenshots.length === 0 && !existing.note) {
      // No remaining content on this day — drop the row instead of leaving
      // an empty placeholder.
      await db.days.delete(id)
      return
    }
    await db.days.put({ ...existing, screenshots, updated_at: ts })
  })
}

export async function getDayNote(
  accountId: string,
  date: string,
): Promise<string> {
  const day = await getDay(accountId, date)
  return day?.note ?? ''
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
    if (trimmed === '' && existing.screenshots.length === 0) {
      await db.days.delete(id)
      return
    }
    await db.days.put({
      ...existing,
      note: trimmed === '' ? undefined : trimmed,
      updated_at: ts,
    })
  })
}

