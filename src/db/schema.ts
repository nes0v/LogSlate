import Dexie, { type EntityTable } from 'dexie'
import type { TradeRecord } from '@/db/types'

class LogslateDB extends Dexie {
  trades!: EntityTable<TradeRecord, 'id'>

  constructor() {
    super('logslate')
    this.version(1).stores({
      trades: '&id, trade_date, symbol, session, updated_at, created_at',
    })
  }
}

export const db = new LogslateDB()
