import type { ContractType, SymbolKey, SymbolSnapshot, TradingSymbol } from '@/db/types'

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

// Preset economics for the built-in CME index futures, keyed by the legacy
// (symbol, contract_type) pair. This is the single source of truth for BOTH:
//   1. the Dexie v13 migration, which turns each pair used by an existing trade
//      into a per-account `TradingSymbol` row, and
//   2. the Symbols-page "quick add" preset buttons.
// Micro contracts take an "M"-prefixed ticker (MNQ / MES / MYM).
//
// CME spec — point value ($/pt), tick size, broker fee ($/side), scratch band
// (points below which |AHPC| counts as a scratch).
export const SYMBOL_PRESETS: Record<SymbolKey, Record<ContractType, SymbolSnapshot>> = {
  NQ: {
    mini: { name: 'NQ', point_value: 20, tick_size: 0.25, fee_per_side: 2.25, scratch_handles: 4 },
    micro: { name: 'MNQ', point_value: 2, tick_size: 0.25, fee_per_side: 0.62, scratch_handles: 4 },
  },
  ES: {
    mini: { name: 'ES', point_value: 50, tick_size: 0.25, fee_per_side: 2.25, scratch_handles: 1.6 },
    micro: { name: 'MES', point_value: 5, tick_size: 0.25, fee_per_side: 0.62, scratch_handles: 1.6 },
  },
  YM: {
    mini: { name: 'YM', point_value: 5, tick_size: 1, fee_per_side: 2.25, scratch_handles: 16 },
    micro: { name: 'MYM', point_value: 0.5, tick_size: 1, fee_per_side: 0.62, scratch_handles: 16 },
  },
}
