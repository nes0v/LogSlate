import { db } from '@/db/schema'
import { createTrade } from '@/db/queries'
import { clearNotifications, pushError, pushInfo } from '@/lib/notifications'

// Small deterministic sample spanning a couple of days — used for dev.
// Call `seedSampleTrades()` from the browser devtools to populate.
export async function seedSampleTrades(): Promise<number> {
  const existing = await db.trades.count()
  if (existing > 0) return 0

  const drafts: Array<Parameters<typeof createTrade>[0]> = [
    {
      date: '2026-04-14',
      symbol: 'NQ',
      contract_type: 'micro',
      session: 'am',
      idea: 'Opening range break — held vwap reclaim, target prior day high.',
      executions: [
        { kind: 'buy', order_type: 'lmt', price: 21050, time: '2026-04-14T13:35:00Z', contracts: 2 },
        { kind: 'buy', order_type: 'lmt', price: 21045, time: '2026-04-14T13:37:00Z', contracts: 1 },
        { kind: 'sell', order_type: 'lmt', price: 21075, time: '2026-04-14T13:50:00Z', contracts: 2 },
        { kind: 'sell', order_type: 'lmt', price: 21080, time: '2026-04-14T14:05:00Z', contracts: 1 },
      ],
      stop_loss: 60,
      profit_target: 120,
      drawdown: 20,
      runup: 110,
      rating: 'good',
      emotion: 'focused',
    },
    {
      date: '2026-04-14',
      symbol: 'NQ',
      contract_type: 'micro',
      session: 'pm',
      idea: 'Fade the pop at resistance — got stopped.',
      executions: [
        { kind: 'sell', order_type: 'lmt', price: 21105, time: '2026-04-14T19:30:00Z', contracts: 1 },
        { kind: 'buy', order_type: 'lmt', price: 21120, time: '2026-04-14T19:45:00Z', contracts: 1 },
      ],
      stop_loss: 40,
      profit_target: 120,
      drawdown: 50,
      runup: 5,
      rating: 'poor',
      emotion: 'frustrated',
    },
    {
      date: '2026-04-15',
      symbol: 'ES',
      contract_type: 'micro',
      session: 'am',
      idea: 'Support bounce, scaled in.',
      executions: [
        { kind: 'buy', order_type: 'lmt', price: 5820, time: '2026-04-15T13:40:00Z', contracts: 1 },
        { kind: 'buy', order_type: 'lmt', price: 5818, time: '2026-04-15T13:45:00Z', contracts: 1 },
        { kind: 'sell', order_type: 'lmt', price: 5830, time: '2026-04-15T14:10:00Z', contracts: 2 },
      ],
      stop_loss: 50,
      profit_target: 100,
      drawdown: 15,
      runup: 70,
      rating: 'excellent',
      emotion: 'calm',
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
      pushError: typeof pushError
      pushInfo: typeof pushInfo
      clearNotifications: typeof clearNotifications
    }
  }
}

if (import.meta.env.DEV) {
  window.__logslate = {
    db,
    seedSampleTrades,
    wipeAllTrades,
    pushError,
    pushInfo,
    clearNotifications,
  }
}
