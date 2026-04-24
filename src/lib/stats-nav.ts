import { addDays, endOfMonth, format } from 'date-fns'
import type { Timeframe } from './buckets'

/**
 * Reads the chart timeframe from URL params. Falls back to `'D'` when
 * the param is missing, empty, or not one of the five valid values.
 */
export function timeframeFromParams(p: URLSearchParams): Timeframe {
  const v = p.get('tf')
  return v === 'D' || v === 'W' || v === 'M' || v === 'Q' || v === 'Y' ? v : 'D'
}

/**
 * Navigation target for a candle click when the click should leave
 * Stats — daily candles go to the day page; the rest map to the
 * containing month on the calendar. For W/M/Q/Y on Stats we drill down
 * via `drillDownRange` instead, keeping the user on /stats.
 */
export function bucketNavTarget(key: string, tf: Timeframe): string {
  switch (tf) {
    case 'D': return `/day/${key}`
    case 'W': return `/month/${key.slice(0, 7)}`
    case 'M': return `/month/${key}`
    case 'Q': {
      const m = /^(\d{4})-Q([1-4])$/.exec(key)
      if (!m) return '/'
      const firstMonth = (Number(m[2]) - 1) * 3 + 1
      return `/month/${m[1]}-${String(firstMonth).padStart(2, '0')}`
    }
    case 'Y': return `/month/${key}-01`
  }
}

/**
 * For a W/M/Q/Y candle click on Stats, returns the filter range to
 * apply (`from`/`to`) and the timeframe to switch the chart to. W→D,
 * M→D, Q→D, Y→W. Returns `null` for D (use `bucketNavTarget` instead)
 * and for unparseable keys.
 */
export function drillDownRange(
  tf: Timeframe,
  key: string,
): { from: string; to: string; tf: Timeframe } | null {
  if (tf === 'W') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
    const ws = new Date(key + 'T00:00:00')
    return {
      from: format(ws, 'yyyy-MM-dd'),
      to: format(addDays(ws, 6), 'yyyy-MM-dd'),
      tf: 'D',
    }
  }
  if (tf === 'M') {
    if (!/^\d{4}-\d{2}$/.test(key)) return null
    const ms = new Date(key + '-01T00:00:00')
    return {
      from: format(ms, 'yyyy-MM-dd'),
      to: format(endOfMonth(ms), 'yyyy-MM-dd'),
      tf: 'D',
    }
  }
  if (tf === 'Q') {
    const m = /^(\d{4})-Q([1-4])$/.exec(key)
    if (!m) return null
    const firstMonth = (Number(m[2]) - 1) * 3 + 1
    const qs = new Date(`${m[1]}-${String(firstMonth).padStart(2, '0')}-01T00:00:00`)
    const qeStart = new Date(`${m[1]}-${String(firstMonth + 2).padStart(2, '0')}-01T00:00:00`)
    return {
      from: format(qs, 'yyyy-MM-dd'),
      to: format(endOfMonth(qeStart), 'yyyy-MM-dd'),
      tf: 'D',
    }
  }
  if (tf === 'Y') {
    if (!/^\d{4}$/.test(key)) return null
    return { from: `${key}-01-01`, to: `${key}-12-31`, tf: 'W' }
  }
  return null
}
