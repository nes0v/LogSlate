import type { SymbolSnapshot, TradingSymbol } from '@/db/types'

// The frozen-economics subset of a symbol, copied onto a trade at log time.
// Single source of truth for the snapshot so the trade form, dev seed, and any
// future caller stay in lockstep.
export function symbolSnapshotOf(s: TradingSymbol): SymbolSnapshot {
  return {
    name: s.name,
    point_value: s.point_value,
    tick_size: s.tick_size,
    fee_per_side: s.fee_per_side,
    scratch_handles: s.scratch_handles,
  }
}
