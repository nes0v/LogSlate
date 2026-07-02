import { useMemo } from 'react'
import type { TradeRecord } from '@/db/types'
import type { TradeFilters } from '@/lib/filters'

export interface WindowRange {
  /** First day of the active window (YYYY-MM-DD), or null when empty. */
  rangeStart: string | null
  /** Last day of the active window, or null when empty. */
  rangeEnd: string | null
}

/**
 * The date window the stats and chart cover. When both `from` and `to` are
 * set the window is exactly that range; otherwise it spans the filtered
 * trades' first..last day, with either explicit bound still honoured if only
 * one side is set. Null bounds mean there are no trades to bound the window.
 *
 * Using the filter bounds (not just days that had trades) lets charts show
 * every day in the period. Shared by Overview and Reports.
 */
export function windowRange(
  filtered: TradeRecord[],
  from: string | null,
  to: string | null,
): WindowRange {
  if (from && to) return { rangeStart: from, rangeEnd: to }
  if (filtered.length === 0) return { rangeStart: null, rangeEnd: null }
  const dates = filtered.map(t => t.date).sort()
  return {
    rangeStart: from ?? dates[0],
    rangeEnd: to ?? dates[dates.length - 1],
  }
}

/** Memoized `windowRange`, keyed on the filtered set and the date bounds. */
export function useWindowRange(filtered: TradeRecord[], filters: TradeFilters): WindowRange {
  const { from, to } = filters
  return useMemo(() => windowRange(filtered, from, to), [filtered, from, to])
}
