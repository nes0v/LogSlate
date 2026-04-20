import Dexie, { type EntityTable } from 'dexie'
import type { EquityAdjustment, Execution, TradeRecord } from '@/db/types'

interface LegacyV1Trade extends Omit<TradeRecord, 'executions'> {
  buys?: Omit<Execution, 'kind'>[]
  sells?: Omit<Execution, 'kind'>[]
}

class LogslateDB extends Dexie {
  trades!: EntityTable<TradeRecord, 'id'>
  adjustments!: EntityTable<EquityAdjustment, 'id'>

  constructor() {
    super('logslate')

    // v1: buys[] / sells[] as separate arrays.
    this.version(1).stores({
      trades: '&id, trade_date, symbol, session, updated_at, created_at',
    })

    // v2: merged executions[] with a `kind` discriminator; sorted by time.
    this.version(2)
      .stores({
        trades: '&id, trade_date, symbol, session, updated_at, created_at',
      })
      .upgrade(async tx => {
        await tx
          .table('trades')
          .toCollection()
          .modify((t: LegacyV1Trade) => {
            const buys = (t.buys ?? []).map(e => ({ ...e, kind: 'buy' as const }))
            const sells = (t.sells ?? []).map(e => ({ ...e, kind: 'sell' as const }))
            const merged = [...buys, ...sells].sort(
              (a, b) => Date.parse(a.time) - Date.parse(b.time),
            )
            ;(t as unknown as TradeRecord).executions = merged
            delete t.buys
            delete t.sells
          })
      })

    // v3: equity adjustments (deposits / withdrawals).
    this.version(3).stores({
      trades: '&id, trade_date, symbol, session, updated_at, created_at',
      adjustments: '&id, date, updated_at, created_at',
    })
  }
}

export const db = new LogslateDB()
