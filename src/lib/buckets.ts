import {
  addDays,
  addMonths,
  eachDayOfInterval,
  eachWeekOfInterval,
  endOfWeek,
  format,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import type { TradeRecord } from '@/db/types'

const DATE_KEY = 'yyyy-MM-dd'
export const WEEK_OPTS = { weekStartsOn: 0 as const } // Sunday

export interface Bucket {
  key: string // stable id: date-key for day, week-start for week, yyyy-MM for month
  label: string // short display label
  rangeStart: string // YYYY-MM-DD inclusive
  rangeEnd: string // YYYY-MM-DD inclusive
  navTarget: string // router path (e.g. /day/2026-04-15)
  trades: TradeRecord[]
}

function groupTrades(trades: TradeRecord[]): Map<string, TradeRecord[]> {
  const m = new Map<string, TradeRecord[]>()
  for (const t of trades) {
    const a = m.get(t.trade_date)
    if (a) a.push(t)
    else m.set(t.trade_date, [t])
  }
  return m
}

export function bucketByDay(trades: TradeRecord[], rangeStart: Date, rangeEnd: Date): Bucket[] {
  const byDay = groupTrades(trades)
  return eachDayOfInterval({ start: rangeStart, end: rangeEnd }).map(d => {
    const key = format(d, DATE_KEY)
    return {
      key,
      label: format(d, 'EEE d'),
      rangeStart: key,
      rangeEnd: key,
      navTarget: `/day/${key}`,
      trades: byDay.get(key) ?? [],
    }
  })
}

export function bucketByWeek(trades: TradeRecord[], rangeStart: Date, rangeEnd: Date): Bucket[] {
  const byDay = groupTrades(trades)
  return eachWeekOfInterval({ start: rangeStart, end: rangeEnd }, WEEK_OPTS).map(weekStart => {
    const ws = startOfWeek(weekStart, WEEK_OPTS)
    const we = endOfWeek(weekStart, WEEK_OPTS)
    const wsKey = format(ws, DATE_KEY)
    const weKey = format(we, DATE_KEY)
    const weekTrades: TradeRecord[] = []
    for (const day of eachDayOfInterval({ start: ws, end: we })) {
      const t = byDay.get(format(day, DATE_KEY))
      if (t) weekTrades.push(...t)
    }
    return {
      key: wsKey,
      label: `${format(ws, 'MMM d')}`,
      rangeStart: wsKey,
      rangeEnd: weKey,
      navTarget: `/week/${wsKey}`,
      trades: weekTrades,
    }
  })
}

// ---------- chart-axis helpers ----------

/**
 * X-axis tick label for a day: just the day number, except the 1st of each
 * month keeps the month prefix so the axis still anchors which month we're in.
 */
export function chartDayLabel(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00')
  return d.getDate() === 1 ? format(d, 'MMM d') : format(d, 'd')
}

// ---------- period navigation helpers ----------

export function parseYearMonth(ym: string | undefined): Date {
  if (ym && /^\d{4}-\d{2}$/.test(ym)) {
    const d = parse(ym, 'yyyy-MM', new Date())
    if (!Number.isNaN(d.getTime())) return startOfMonth(d)
  }
  return startOfMonth(new Date())
}

export function parseWeekStart(d: string | undefined): Date {
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const parsed = parse(d, DATE_KEY, new Date())
    if (!Number.isNaN(parsed.getTime())) return startOfWeek(parsed, WEEK_OPTS)
  }
  return startOfWeek(new Date(), WEEK_OPTS)
}

export function weekBounds(weekStart: Date) {
  return { start: startOfWeek(weekStart, WEEK_OPTS), end: endOfWeek(weekStart, WEEK_OPTS) }
}
export function addWeek(d: Date, n: number): Date {
  return addDays(d, n * 7)
}
export { addMonths, addDays }
