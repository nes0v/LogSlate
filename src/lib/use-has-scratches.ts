import { useEffect, useMemo } from 'react'
import { applyFilters, type TradeFilters } from '@/lib/filters'
import { classifyTrade } from '@/lib/trade-math'
import type { TradeRecord } from '@/db/types'

// Per-account last-known answer, mirroring `lastHasOverrides` in
// use-include-overrides. The header (with the toggle) paints before the data
// gate, so a remembered value keeps the toggle from flashing in/out on load.
const lastHasScratches = new Map<string, boolean>()

/**
 * Whether the current view — after every filter EXCEPT the scratch toggle — has
 * any scratch trade. Used to hide the "Show scratch trades" toggle when there's
 * nothing to hide, the same way `hasOverridesInWindow` hides the override
 * toggle. Detection is toggle-independent (`includeScratches: true`) so the
 * toggle still shows while scratches are hidden, letting the user turn them
 * back on.
 */
export function useHasScratchesInWindow(
  accountId: string,
  allTrades: TradeRecord[] | undefined,
  filters: TradeFilters,
  ready: boolean,
): boolean {
  const live = useMemo(
    () =>
      applyFilters(allTrades ?? [], filters, true).some(
        t => classifyTrade(t) === 'scratch',
      ),
    [allTrades, filters],
  )
  useEffect(() => {
    if (ready) lastHasScratches.set(accountId, live)
  }, [ready, accountId, live])
  return ready ? live : (lastHasScratches.get(accountId) ?? false)
}
