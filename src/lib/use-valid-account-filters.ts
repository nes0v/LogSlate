import { useEffect, useRef } from 'react'
import type { Model, TradeRecord, TradingSymbol } from '@/db/types'
import { MODEL_NONE } from '@/lib/filters'

/**
 * Clears account-scoped filters carried over from another account.
 *
 * `symbol_id` and `model` are per-account ids (unlike the old cross-account
 * `NQ` symbol enum). Switching accounts — or any URL / shared-filter carried
 * over — leaves a foreign id that matches zero trades, so the page renders
 * empty with no pill highlighted to explain why. When an id is unknown to the
 * account we drop it back to "All".
 *
 * "Known" means one of the account's own symbols/models — used or not, so
 * picking a model with no trades yet shows the honest empty state instead of
 * snapping back to "All". Also kept: a since-deleted symbol/model that still
 * has trades (its orphans stay filterable via the id on their records), and
 * the `MODEL_NONE` sentinel ("no model"), which is valid in every account.
 *
 * Shared by the Overview and Reports pages so they can't drift.
 */
export function useValidAccountFilters(
  allTrades: TradeRecord[] | undefined,
  symbols: TradingSymbol[] | undefined,
  models: Model[] | undefined,
  symbolId: string | null,
  model: string | null,
  onDrop: (patch: { symbol_id?: null; model?: null }) => void,
): void {
  // Keep the callback in a ref so the effect only re-runs on data/filter
  // changes, not on every parent render (the page's `update` is a fresh
  // closure each time).
  const onDropRef = useRef(onDrop)
  useEffect(() => {
    onDropRef.current = onDrop
  })

  useEffect(() => {
    if (allTrades === undefined || symbols === undefined || models === undefined) return
    const patch: { symbol_id?: null; model?: null } = {}
    if (
      symbolId &&
      !symbols.some(s => s.id === symbolId) &&
      !allTrades.some(t => t.symbol_id === symbolId)
    ) patch.symbol_id = null
    if (
      model &&
      model !== MODEL_NONE &&
      !models.some(m => m.id === model) &&
      !allTrades.some(t => t.model_id === model)
    ) patch.model = null
    if (patch.symbol_id !== undefined || patch.model !== undefined) onDropRef.current(patch)
  }, [allTrades, symbols, models, symbolId, model])
}
