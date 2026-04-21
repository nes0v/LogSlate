import { db } from '@/db/schema'
import type {
  Account,
  AccountDraft,
  AdjustmentDraft,
  EquityAdjustment,
  TradeDraft,
  TradeRecord,
} from '@/db/types'
import { MAIN_ACCOUNT_ID } from '@/db/types'
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

export async function listTradesByDate(date: string, accountId: string): Promise<TradeRecord[]> {
  return db.trades
    .where('[account_id+trade_date]')
    .equals([accountId, date])
    .sortBy('created_at')
}

export async function listTradesInRange(
  startDate: string,
  endDate: string,
  accountId: string,
): Promise<TradeRecord[]> {
  return db.trades
    .where('[account_id+trade_date]')
    .between([accountId, startDate], [accountId, endDate], true, true)
    .sortBy('trade_date')
}

export async function listAllTrades(accountId: string): Promise<TradeRecord[]> {
  return db.trades
    .where('[account_id+trade_date]')
    .between([accountId, ''], [accountId, '￿'], true, true)
    .toArray()
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

export async function renameAccount(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Account name is required.')
  await db.accounts.update(id, { name: trimmed, updated_at: now() })
}

// Cascading delete: the account's trades and adjustments go with it. Refuses
// to delete the Main account (UI also disables this, but we guard server-side
// too).
export async function deleteAccount(id: string): Promise<void> {
  if (id === MAIN_ACCOUNT_ID) throw new Error('The Main account cannot be deleted.')
  await db.transaction('rw', db.accounts, db.trades, db.adjustments, async () => {
    await db.trades.where('account_id').equals(id).delete()
    await db.adjustments.where('account_id').equals(id).delete()
    await db.accounts.delete(id)
  })
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
