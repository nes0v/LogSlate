import { db } from '@/db/schema'
import { createTrade } from '@/db/queries'

// Small deterministic sample spanning a couple of weeks — used for dev.
// Call `seedSampleTrades()` from the browser devtools to populate.
export async function seedSampleTrades(): Promise<number> {
  const existing = await db.trades.count()
  if (existing > 0) return 0

  const drafts: Array<Parameters<typeof createTrade>[0]> = [
    {
      trade_date: '2026-04-14',
      symbol: 'NQ',
      contract_type: 'micro',
      session: 'AM',
      idea: 'Opening range break — held vwap reclaim, target prior day high.',
      buys: [
        { price: 21050, time: '2026-04-14T13:35:00Z', contracts: 2 },
        { price: 21045, time: '2026-04-14T13:37:00Z', contracts: 1 },
      ],
      sells: [
        { price: 21075, time: '2026-04-14T13:50:00Z', contracts: 2 },
        { price: 21080, time: '2026-04-14T14:05:00Z', contracts: 1 },
      ],
      stop_loss: 60,
      drawdown: 20,
      buildup: 110,
      planned_rr: 2,
      rating: 'good',
      pnl_override: null,
      screenshot: null,
    },
    {
      trade_date: '2026-04-14',
      symbol: 'NQ',
      contract_type: 'micro',
      session: 'PM',
      idea: 'Fade the pop at resistance — got stopped.',
      buys: [{ price: 21120, time: '2026-04-14T19:45:00Z', contracts: 1 }],
      sells: [{ price: 21105, time: '2026-04-14T19:30:00Z', contracts: 1 }],
      stop_loss: 40,
      drawdown: 50,
      buildup: 5,
      planned_rr: 3,
      rating: 'meh',
      pnl_override: null,
      screenshot: null,
    },
    {
      trade_date: '2026-04-15',
      symbol: 'ES',
      contract_type: 'micro',
      session: 'AM',
      idea: 'Support bounce, scaled in.',
      buys: [
        { price: 5820, time: '2026-04-15T13:40:00Z', contracts: 1 },
        { price: 5818, time: '2026-04-15T13:45:00Z', contracts: 1 },
      ],
      sells: [{ price: 5830, time: '2026-04-15T14:10:00Z', contracts: 2 }],
      stop_loss: 50,
      drawdown: 15,
      buildup: 70,
      planned_rr: 2,
      rating: 'excellent',
      pnl_override: null,
      screenshot: null,
    },
  ]

  for (const d of drafts) await createTrade(d)
  return drafts.length
}

// Convenience to wipe during dev.
export async function wipeAllTrades(): Promise<void> {
  await db.trades.clear()
}

// Expose on window for manual dev use.
declare global {
  interface Window {
    __logslate?: {
      db: typeof db
      seedSampleTrades: typeof seedSampleTrades
      wipeAllTrades: typeof wipeAllTrades
    }
  }
}

if (import.meta.env.DEV) {
  window.__logslate = { db, seedSampleTrades, wipeAllTrades }
}
