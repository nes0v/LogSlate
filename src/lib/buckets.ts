import {
  addDays,
  addMonths,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachQuarterOfInterval,
  eachWeekOfInterval,
  eachYearOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  getQuarter,
  parse,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import type { TradeRecord } from '@/db/types'

export type Timeframe = 'D' | 'W' | 'M' | 'Q' | 'Y'

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
      navTarget: `/month/${wsKey.slice(0, 7)}`,
      trades: weekTrades,
    }
  })
}

// ---------- month / quarter / year buckets ----------

function quarterKey(d: Date): string {
  return `${d.getFullYear()}-Q${getQuarter(d)}`
}

export function bucketByMonth(trades: TradeRecord[], rangeStart: Date, rangeEnd: Date): Bucket[] {
  const byDay = groupTrades(trades)
  return eachMonthOfInterval({ start: startOfMonth(rangeStart), end: endOfMonth(rangeEnd) }).map(m => {
    const ms = startOfMonth(m)
    const me = endOfMonth(m)
    const key = format(ms, 'yyyy-MM')
    const mTrades: TradeRecord[] = []
    for (const day of eachDayOfInterval({ start: ms, end: me })) {
      const t = byDay.get(format(day, DATE_KEY))
      if (t) mTrades.push(...t)
    }
    return {
      key,
      label: key,
      rangeStart: format(ms, DATE_KEY),
      rangeEnd: format(me, DATE_KEY),
      navTarget: `/month/${key}`,
      trades: mTrades,
    }
  })
}

export function bucketByQuarter(trades: TradeRecord[], rangeStart: Date, rangeEnd: Date): Bucket[] {
  const byDay = groupTrades(trades)
  return eachQuarterOfInterval({ start: startOfQuarter(rangeStart), end: endOfQuarter(rangeEnd) }).map(q => {
    const qs = startOfQuarter(q)
    const qe = endOfQuarter(q)
    const key = quarterKey(qs)
    const qTrades: TradeRecord[] = []
    for (const day of eachDayOfInterval({ start: qs, end: qe })) {
      const t = byDay.get(format(day, DATE_KEY))
      if (t) qTrades.push(...t)
    }
    return {
      key,
      label: key,
      rangeStart: format(qs, DATE_KEY),
      rangeEnd: format(qe, DATE_KEY),
      navTarget: `/month/${format(qs, 'yyyy-MM')}`,
      trades: qTrades,
    }
  })
}

export function bucketByYear(trades: TradeRecord[], rangeStart: Date, rangeEnd: Date): Bucket[] {
  const byDay = groupTrades(trades)
  return eachYearOfInterval({ start: startOfYear(rangeStart), end: endOfYear(rangeEnd) }).map(y => {
    const ys = startOfYear(y)
    const ye = endOfYear(y)
    const key = format(ys, 'yyyy')
    const yTrades: TradeRecord[] = []
    for (const day of eachDayOfInterval({ start: ys, end: ye })) {
      const t = byDay.get(format(day, DATE_KEY))
      if (t) yTrades.push(...t)
    }
    return {
      key,
      label: key,
      rangeStart: format(ys, DATE_KEY),
      rangeEnd: format(ye, DATE_KEY),
      navTarget: `/month/${format(ys, 'yyyy-MM')}`,
      trades: yTrades,
    }
  })
}

export function bucketByTimeframe(
  tf: Timeframe,
  trades: TradeRecord[],
  rangeStart: Date,
  rangeEnd: Date,
): Bucket[] {
  switch (tf) {
    case 'D': return bucketByDay(trades, rangeStart, rangeEnd)
    case 'W': return bucketByWeek(trades, rangeStart, rangeEnd)
    case 'M': return bucketByMonth(trades, rangeStart, rangeEnd)
    case 'Q': return bucketByQuarter(trades, rangeStart, rangeEnd)
    case 'Y': return bucketByYear(trades, rangeStart, rangeEnd)
  }
}

/** Maps a YYYY-MM-DD date string to the bucket key for the given timeframe. */
export function dateToBucketKey(dateKey: string, tf: Timeframe): string {
  const d = new Date(dateKey + 'T00:00:00')
  switch (tf) {
    case 'D': return dateKey
    case 'W': return format(startOfWeek(d, WEEK_OPTS), DATE_KEY)
    case 'M': return format(d, 'yyyy-MM')
    case 'Q': return quarterKey(d)
    case 'Y': return format(d, 'yyyy')
  }
}

/**
 * Parses any bucket key back into the UTC-second timestamp at the start of
 * that bucket. Accepts every format `dateToBucketKey` produces:
 *   • YYYY-MM-DD (D / W)
 *   • YYYY-MM    (M)
 *   • YYYY-Qn    (Q)
 *   • YYYY       (Y)
 * Returns 0 for unparseable input so the caller can treat it as a skip.
 */
export function bucketKeyToTs(key: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return Math.floor(
      Date.UTC(
        Number(key.slice(0, 4)),
        Number(key.slice(5, 7)) - 1,
        Number(key.slice(8, 10)),
      ) / 1000,
    )
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    return Math.floor(
      Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1) / 1000,
    )
  }
  const qm = /^(\d{4})-Q(\d)$/.exec(key)
  if (qm) {
    return Math.floor(Date.UTC(Number(qm[1]), (Number(qm[2]) - 1) * 3, 1) / 1000)
  }
  if (/^\d{4}$/.test(key)) return Math.floor(Date.UTC(Number(key), 0, 1) / 1000)
  return 0
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
