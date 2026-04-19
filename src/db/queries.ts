import { db } from '@/db/schema'
import type { TradeDraft, TradeRecord } from '@/db/types'

function now(): string {
  return new Date().toISOString()
}

function newId(): string {
  return crypto.randomUUID()
}

export async function createTrade(draft: TradeDraft): Promise<TradeRecord> {
  const ts = now()
  const rec: TradeRecord = { ...draft, id: newId(), created_at: ts, updated_at: ts }
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

export async function listTradesByDate(date: string): Promise<TradeRecord[]> {
  return db.trades.where('trade_date').equals(date).sortBy('created_at')
}

export async function listTradesInRange(startDate: string, endDate: string): Promise<TradeRecord[]> {
  return db.trades.where('trade_date').between(startDate, endDate, true, true).sortBy('trade_date')
}

export async function listAllTrades(): Promise<TradeRecord[]> {
  return db.trades.orderBy('trade_date').toArray()
}
