import { useEffect, useRef } from 'react'
import type { TradeRecord } from '@/db/types'
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
 * Kept deliberately: a since-deleted symbol/model that still has trades (its
 * orphans stay filterable via the id on their records), and the `MODEL_NONE`
 * sentinel ("no model"), which is valid in every account.
 *
 * Shared by the Overview and Reports pages so they can't drift.
 */
export function useValidAccountFilters(
  allTrades: TradeRecord[] | undefined,
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
    if (allTrades === undefined) return
    const patch: { symbol_id?: null; model?: null } = {}
    if (symbolId && !allTrades.some(t => t.symbol_id === symbolId)) patch.symbol_id = null
    if (model && model !== MODEL_NONE && !allTrades.some(t => t.model_id === model)) patch.model = null
    if (patch.symbol_id !== undefined || patch.model !== undefined) onDropRef.current(patch)
  }, [allTrades, symbolId, model])
}
