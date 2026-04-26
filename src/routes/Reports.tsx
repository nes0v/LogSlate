import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format, startOfMonth } from 'date-fns'
import { X } from 'lucide-react'
import type { ContractType, Rating, Session, SymbolKey, TradeRecord } from '@/db/types'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import {
  applyFilters,
  filtersFromParams,
  paramsFromFilters,
  type TradeFilters,
} from '@/lib/filters'
import { aggregate } from '@/lib/trade-stats'
import { computePlannedRr, computeRealizedRr, effectivePnl, totalContracts } from '@/lib/trade-math'
import {
  cohortStats,
  holdTimeBuckets,
  maeScatter,
  mfeScatter,
  pnlByHour,
  pnlByMonth,
  pnlByWeekday,
  rDistribution,
  type ScatterPoint,
} from '@/lib/advanced-stats'
import { formatUsd } from '@/lib/money'
import { Pills } from '@/components/form/Pills'
import { Field, inputClass } from '@/components/form/Field'
import { cn } from '@/lib/utils'

// ----- shared filter option lists ---------------------------------------

const SYMBOL_OPTS = [
  { value: null, label: 'All' },
  { value: 'NQ' as const, label: 'NQ' },
  { value: 'ES' as const, label: 'ES' },
] satisfies Array<{ value: SymbolKey | null; label: string }>
const CONTRACT_OPTS = [
  { value: null, label: 'All' },
  { value: 'micro' as const, label: 'micro' },
  { value: 'mini' as const, label: 'mini' },
] satisfies Array<{ value: ContractType | null; label: string }>
const SESSION_OPTS = [
  { value: null, label: 'All' },
  { value: 'pre' as const, label: 'pre' },
  { value: 'AM' as const, label: 'AM' },
  { value: 'LT' as const, label: 'LT' },
  { value: 'PM' as const, label: 'PM' },
  { value: 'aft' as const, label: 'aft' },
] satisfies Array<{ value: Session | null; label: string }>
const RATING_OPTS = [
  { value: null, label: 'All' },
  { value: 'good' as const, label: '👍' },
  { value: 'excellent' as const, label: '🔥' },
  { value: 'egg' as const, label: '🥚' },
] satisfies Array<{ value: Rating | null; label: string }>

type ReportTab = 'days' | 'symbol' | 'risk' | 'cohort' | 'compare'
const TABS: Array<{ value: ReportTab; label: string }> = [
  { value: 'days', label: 'Days & time' },
  { value: 'symbol', label: 'Symbol' },
  { value: 'risk', label: 'Risk' },
  { value: 'cohort', label: 'Wins vs losses' },
  { value: 'compare', label: 'Compare' },
]

type CompareAxis = 'symbol' | 'contract' | 'session' | 'rating' | 'side' | 'planned'

function defaultRange(baseDate: string) {
  const base = new Date(baseDate + 'T00:00:00')
  return {
    from: format(startOfMonth(addDays(base, -89)), 'yyyy-MM-dd'),
    to: baseDate,
  }
}

export function ReportsRoute() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const urlFilters = filtersFromParams(params)
  const tab = (params.get('tab') as ReportTab) || 'days'
  const compareAxis = (params.get('axis') as CompareAxis) || 'symbol'

  const accountId = useActiveAccountId()
  const allTrades = useLiveQuery(
    () =>
      db.trades
        .where('[account_id+trade_date]')
        .between([accountId, ''], [accountId, '￿'], true, true)
        .toArray(),
    [accountId],
    [],
  )

  const lastTradeDate = useMemo(() => {
    const list = allTrades ?? []
    if (list.length === 0) return format(new Date(), 'yyyy-MM-dd')
    let max = list[0].trade_date
    for (const t of list) if (t.trade_date > max) max = t.trade_date
    return max
  }, [allTrades])

  const filters = useMemo<TradeFilters>(() => {
    const d = defaultRange(lastTradeDate)
    return {
      ...urlFilters,
      from: urlFilters.from ?? d.from,
      to: urlFilters.to ?? d.to,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, lastTradeDate])

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const filtered = useMemo(
    () => applyFilters(allTrades ?? [], filters),
    [allTrades, filters],
  )

  function update(next: Partial<TradeFilters>) {
    const d = defaultRange(lastTradeDate)
    const merged: TradeFilters = { ...urlFilters, ...next }
    if (merged.from === d.from) merged.from = null
    if (merged.to === d.to) merged.to = null
    const p = paramsFromFilters(merged)
    if (tab !== 'days') p.set('tab', tab)
    if (tab === 'compare' && compareAxis !== 'symbol') p.set('axis', compareAxis)
    setParams(p)
  }
  function setTab(t: ReportTab) {
    const p = paramsFromFilters(urlFilters)
    if (t !== 'days') p.set('tab', t)
    if (t === 'compare' && compareAxis !== 'symbol') p.set('axis', compareAxis)
    setParams(p)
  }
  function setCompareAxis(a: CompareAxis) {
    const p = paramsFromFilters(urlFilters)
    p.set('tab', 'compare')
    if (a !== 'symbol') p.set('axis', a)
    setParams(p)
  }
  function clear() {
    setParams(new URLSearchParams())
  }

  const isDefault = params.toString() === ''

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Reports</h1>
        {!isDefault && (
          <button
            onClick={clear}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-(--radius) border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
          >
            <X className="size-3" /> Clear
          </button>
        )}
      </div>

      {/* Filter bar */}
      <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" className="w-40">
            <input
              type="date"
              className={inputClass}
              value={filters.from ?? ''}
              onChange={e => update({ from: e.target.value || null })}
            />
          </Field>
          <Field label="To" className="w-40">
            <input
              type="date"
              className={inputClass}
              value={filters.to ?? ''}
              onChange={e => update({ to: e.target.value || null })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Field label="Symbol">
            <Pills value={filters.symbol} onChange={v => update({ symbol: v })} options={SYMBOL_OPTS} />
          </Field>
          <Field label="Contract">
            <Pills value={filters.contract} onChange={v => update({ contract: v })} options={CONTRACT_OPTS} />
          </Field>
          <Field label="Session">
            <Pills value={filters.session} onChange={v => update({ session: v })} options={SESSION_OPTS} />
          </Field>
          <Field label="Rating">
            <Pills value={filters.rating} onChange={v => update({ rating: v })} options={RATING_OPTS} />
          </Field>
        </div>
      </section>

      {/* Tab bar */}
      <section className="flex flex-wrap items-center gap-1 text-xs font-mono border-b border-(--color-border)">
        {TABS.map(t => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              'px-3 py-2 -mb-px border-b-2 transition-colors',
              tab === t.value
                ? 'border-(--color-accent) text-(--color-text)'
                : 'border-transparent text-(--color-text-dim) hover:text-(--color-text)',
            )}
          >
            {t.label}
          </button>
        ))}
      </section>

      {filtered.length === 0 ? (
        <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
          {(allTrades ?? []).length === 0
            ? 'No trades yet.'
            : 'No trades match the current filters.'}
        </div>
      ) : tab === 'days' ? (
        <DaysAndTimeReport trades={filtered} onTradeClick={id => navigate(`/trade/${id}/edit`)} />
      ) : tab === 'symbol' ? (
        <SymbolReport trades={filtered} />
      ) : tab === 'risk' ? (
        <RiskReport trades={filtered} onTradeClick={id => navigate(`/trade/${id}/edit`)} />
      ) : tab === 'cohort' ? (
        <CohortReport trades={filtered} />
      ) : (
        <CompareReport trades={filtered} axis={compareAxis} onAxisChange={setCompareAxis} />
      )}
    </div>
  )
}

// =====================================================================
// Tab: Days & Time
// =====================================================================

function DaysAndTimeReport({
  trades,
}: {
  trades: TradeRecord[]
  onTradeClick?: (id: string) => void
}) {
  const weekday = useMemo(() => pnlByWeekday(trades), [trades])
  const hour = useMemo(() => pnlByHour(trades), [trades])
  const month = useMemo(() => pnlByMonth(trades), [trades])
  const hold = useMemo(() => holdTimeBuckets(trades), [trades])

  const dayOfMonth = useMemo(() => {
    const map = Array.from({ length: 31 }, (_, i) => ({
      day: i + 1,
      pnl: 0,
      count: 0,
      wins: 0,
      losses: 0,
    }))
    for (const t of trades) {
      const d = Number(t.trade_date.slice(8, 10))
      if (d < 1 || d > 31) continue
      const cell = map[d - 1]
      const p = effectivePnl(t) ?? 0
      cell.pnl += p
      cell.count++
      if (p > 0) cell.wins++
      else if (p < 0) cell.losses++
    }
    return map
  }, [trades])

  return (
    <div className="space-y-6">
      <SectionGrid>
        <Card title="Day of week">
          <ReportTable
            rows={weekday
              .filter(w => w.count > 0)
              .map(w => ({
                label: w.name,
                count: w.count,
                wins: w.wins,
                losses: w.losses,
                pnl: w.pnl,
              }))}
          />
        </Card>
        <Card title="Day of month">
          <ReportTable
            rows={dayOfMonth
              .filter(d => d.count > 0)
              .map(d => ({
                label: String(d.day),
                count: d.count,
                wins: d.wins,
                losses: d.losses,
                pnl: d.pnl,
              }))}
          />
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card title="P&L by hour" caption="local-time first execution">
          <HourRow data={hour} />
        </Card>
        <Card title="Hold time" caption="winners vs losers per duration">
          <HoldRow data={hold} />
        </Card>
      </SectionGrid>

      <Card title="Monthly returns">
        <ReportTable
          rows={month.map(m => ({
            label: m.month,
            count: m.count,
            wins: 0,
            losses: 0,
            pnl: m.pnl,
            hideWl: true,
          }))}
        />
      </Card>
    </div>
  )
}

// =====================================================================
// Tab: Symbol
// =====================================================================

function SymbolReport({ trades }: { trades: TradeRecord[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, TradeRecord[]>()
    for (const t of trades) {
      const k = `${t.symbol} ${t.contract_type}`
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(t)
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }, [trades])
  if (groups.length === 0) {
    return <div className="text-sm text-(--color-text-dim) text-center py-12">No data.</div>
  }
  return (
    <div className="space-y-4">
      {groups.map(([key, list]) => {
        const stats = aggregate(list)
        const cohort = cohortStats(list)
        return (
          <Card key={key} title={key} caption={`${stats.count} trades`}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <Stat
                label="Net P&L"
                value={formatUsd(stats.net_pnl)}
                tone={stats.net_pnl > 0 ? 'win' : stats.net_pnl < 0 ? 'loss' : 'dim'}
              />
              <Stat
                label="Win rate"
                value={
                  stats.win_rate === null
                    ? '—'
                    : `${Math.round(stats.win_rate * 100)}%`
                }
                caption={`${stats.wins}W / ${stats.losses}L`}
              />
              <Stat
                label="Avg win"
                value={stats.avg_win === null ? '—' : formatUsd(stats.avg_win)}
                tone={stats.avg_win === null ? 'dim' : 'win'}
              />
              <Stat
                label="Avg loss"
                value={stats.avg_loss === null ? '—' : formatUsd(stats.avg_loss)}
                tone={stats.avg_loss === null ? 'dim' : 'loss'}
              />
              <Stat
                label="Avg duration"
                value={fmtDuration(cohort.avgDuration_ms)}
              />
              <Stat label="Total fees" value={formatUsd(-stats.fees)} />
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// =====================================================================
// Tab: Risk (volume / position size / R-multiples)
// =====================================================================

function RiskReport({
  trades,
  onTradeClick,
}: {
  trades: TradeRecord[]
  onTradeClick?: (id: string) => void
}) {
  const rDist = useMemo(() => rDistribution(trades), [trades])
  const maePoints = useMemo(() => maeScatter(trades), [trades])
  const mfePoints = useMemo(() => mfeScatter(trades), [trades])
  const [scatter, setScatter] = useState<'mae' | 'mfe'>('mfe')

  // Position size (by contract count) breakdown.
  const sizeRows = useMemo(() => {
    const map = new Map<number, { count: number; wins: number; losses: number; pnl: number }>()
    for (const t of trades) {
      const c = totalContracts(t)
      if (c === 0) continue
      const cur = map.get(c) ?? { count: 0, wins: 0, losses: 0, pnl: 0 }
      const p = effectivePnl(t) ?? 0
      cur.count++
      if (p > 0) cur.wins++
      else if (p < 0) cur.losses++
      cur.pnl += p
      map.set(c, cur)
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => ({ label: `${k} ct`, ...v }))
  }, [trades])

  // Planned R analysis.
  const plannedRows = useMemo(() => {
    const map = new Map<number, { count: number; wins: number; losses: number; pnl: number; realizedSum: number; realizedN: number }>()
    for (const t of trades) {
      const planned = computePlannedRr(t)
      if (planned === null) continue
      // Bucket by rounded R:R since exact ratios are continuous now.
      const key = Math.max(1, Math.round(planned))
      const cur = map.get(key) ?? {
        count: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        realizedSum: 0,
        realizedN: 0,
      }
      const p = effectivePnl(t) ?? 0
      cur.count++
      if (p > 0) cur.wins++
      else if (p < 0) cur.losses++
      cur.pnl += p
      const rr = computeRealizedRr(t)
      if (rr !== null) {
        cur.realizedSum += rr
        cur.realizedN++
      }
      map.set(key, cur)
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => ({
        label: `${k}×`,
        count: v.count,
        wins: v.wins,
        losses: v.losses,
        pnl: v.pnl,
        avgRealized: v.realizedN > 0 ? v.realizedSum / v.realizedN : null,
      }))
  }, [trades])

  return (
    <div className="space-y-6">
      <SectionGrid>
        <Card title="R-multiple distribution">
          <RDistRows buckets={rDist} />
        </Card>
        <Card
          title={scatter === 'mfe' ? 'P&L vs MFE' : 'P&L vs MAE'}
          caption={
            scatter === 'mfe'
              ? 'how much each trade gave back from peak'
              : 'how much heat each trade took'
          }
          right={
            <div className="flex gap-1 text-xs font-mono">
              <ToggleBtn active={scatter === 'mfe'} onClick={() => setScatter('mfe')}>
                MFE
              </ToggleBtn>
              <ToggleBtn active={scatter === 'mae'} onClick={() => setScatter('mae')}>
                MAE
              </ToggleBtn>
            </div>
          }
        >
          <Scatter
            points={scatter === 'mfe' ? mfePoints : maePoints}
            onClick={onTradeClick ? p => onTradeClick(p.id) : undefined}
          />
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card title="Position size" caption="contracts per trade">
          <ReportTable rows={sizeRows} />
        </Card>
        <Card title="Planned R" caption="how often does each R target fire?">
          <PlannedRRTable rows={plannedRows} />
        </Card>
      </SectionGrid>
    </div>
  )
}

// =====================================================================
// Tab: Wins vs Losses
// =====================================================================

function CohortReport({ trades }: { trades: TradeRecord[] }) {
  const winners = useMemo(
    () => trades.filter(t => (effectivePnl(t) ?? 0) > 0),
    [trades],
  )
  const losers = useMemo(
    () => trades.filter(t => (effectivePnl(t) ?? 0) < 0),
    [trades],
  )
  const w = useMemo(() => cohortStats(winners), [winners])
  const l = useMemo(() => cohortStats(losers), [losers])
  const wHold = useMemo(() => holdTimeBuckets(winners), [winners])
  const lHold = useMemo(() => holdTimeBuckets(losers), [losers])

  const rows: Array<{ label: string; w: string; l: string }> = [
    { label: 'Trades', w: `${w.count}`, l: `${l.count}` },
    {
      label: 'Avg realised R',
      w: w.avgRr === null ? '—' : w.avgRr.toFixed(2),
      l: l.avgRr === null ? '—' : l.avgRr.toFixed(2),
    },
    {
      label: 'Avg duration',
      w: fmtDuration(w.avgDuration_ms),
      l: fmtDuration(l.avgDuration_ms),
    },
    {
      label: 'Avg MAE',
      w: w.avgMae === null ? '—' : formatUsd(-w.avgMae),
      l: l.avgMae === null ? '—' : formatUsd(-l.avgMae),
    },
    {
      label: 'Avg MFE',
      w: w.avgMfe === null ? '—' : formatUsd(w.avgMfe),
      l: l.avgMfe === null ? '—' : formatUsd(l.avgMfe),
    },
    {
      label: 'Avg fees',
      w: formatUsd(-w.avgFees),
      l: formatUsd(-l.avgFees),
    },
  ]
  return (
    <div className="space-y-6">
      <Card title="Winners vs Losers">
        <div className="text-sm">
          <div className="grid grid-cols-[1fr_120px_120px] gap-2 py-1 border-b border-(--color-border) text-(--color-text-dim) text-xs">
            <div></div>
            <div className="text-right text-(--color-win)">Winners</div>
            <div className="text-right text-(--color-loss)">Losers</div>
          </div>
          {rows.map(r => (
            <div
              key={r.label}
              className="grid grid-cols-[1fr_120px_120px] gap-2 py-1.5 border-b border-(--color-border)/40 last:border-b-0"
            >
              <div className="text-(--color-text-dim)">{r.label}</div>
              <div className="text-right font-mono tabular-nums">{r.w}</div>
              <div className="text-right font-mono tabular-nums">{r.l}</div>
            </div>
          ))}
        </div>
      </Card>

      <SectionGrid>
        <Card title="Winners — hold time">
          <HoldRow data={wHold} />
        </Card>
        <Card title="Losers — hold time">
          <HoldRow data={lHold} />
        </Card>
      </SectionGrid>
    </div>
  )
}

// =====================================================================
// Tab: Compare (split by axis)
// =====================================================================

const COMPARE_AXES: Array<{ value: CompareAxis; label: string }> = [
  { value: 'symbol', label: 'Symbol' },
  { value: 'contract', label: 'Contract' },
  { value: 'session', label: 'Session' },
  { value: 'rating', label: 'Rating' },
  { value: 'side', label: 'Long / short' },
  { value: 'planned', label: 'Planned R' },
]

function CompareReport({
  trades,
  axis,
  onAxisChange,
}: {
  trades: TradeRecord[]
  axis: CompareAxis
  onAxisChange: (a: CompareAxis) => void
}) {
  const groups = useMemo(() => splitByAxis(trades, axis), [trades, axis])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 text-xs font-mono">
        {COMPARE_AXES.map(a => (
          <button
            key={a.value}
            type="button"
            onClick={() => onAxisChange(a.value)}
            className={cn(
              'px-2 py-1 rounded-(--radius) border transition-colors',
              axis === a.value
                ? 'border-(--color-border) bg-(--color-panel-2) text-(--color-text)'
                : 'border-transparent text-(--color-text-dim) hover:text-(--color-text)',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="text-sm text-(--color-text-dim) text-center py-6">
          Nothing to compare on this axis.
        </div>
      ) : (
        <Card title={`Split by ${axis}`}>
          <CompareTable groups={groups} />
        </Card>
      )}
    </div>
  )
}

function splitByAxis(
  trades: TradeRecord[],
  axis: CompareAxis,
): Array<{ label: string; trades: TradeRecord[] }> {
  switch (axis) {
    case 'symbol':
      return [
        { label: 'NQ', trades: trades.filter(t => t.symbol === 'NQ') },
        { label: 'ES', trades: trades.filter(t => t.symbol === 'ES') },
      ].filter(g => g.trades.length > 0)
    case 'contract':
      return [
        { label: 'micro', trades: trades.filter(t => t.contract_type === 'micro') },
        { label: 'mini', trades: trades.filter(t => t.contract_type === 'mini') },
      ].filter(g => g.trades.length > 0)
    case 'session':
      return (['pre', 'AM', 'LT', 'PM', 'aft'] as const)
        .map(s => ({ label: s, trades: trades.filter(t => t.session === s) }))
        .filter(g => g.trades.length > 0)
    case 'rating':
      return [
        { label: '👍 good', trades: trades.filter(t => t.rating === 'good') },
        { label: '🔥 excellent', trades: trades.filter(t => t.rating === 'excellent') },
        { label: '🥚 egg', trades: trades.filter(t => t.rating === 'egg') },
      ].filter(g => g.trades.length > 0)
    case 'side': {
      const longs: TradeRecord[] = []
      const shorts: TradeRecord[] = []
      for (const t of trades) {
        const buys = t.executions.filter(e => e.kind === 'buy')
        const sells = t.executions.filter(e => e.kind === 'sell')
        const firstBuy = buys.length > 0 ? Date.parse(buys[0].time) : Infinity
        const firstSell = sells.length > 0 ? Date.parse(sells[0].time) : Infinity
        if (firstBuy <= firstSell) longs.push(t)
        else shorts.push(t)
      }
      return [
        { label: 'long', trades: longs },
        { label: 'short', trades: shorts },
      ].filter(g => g.trades.length > 0)
    }
    case 'planned': {
      const map = new Map<number, TradeRecord[]>()
      for (const t of trades) {
        const planned = computePlannedRr(t)
        if (planned === null) continue
        const key = Math.max(1, Math.round(planned))
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(t)
      }
      return Array.from(map.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => ({ label: `${k}×`, trades: v }))
    }
  }
}

function CompareTable({ groups }: { groups: Array<{ label: string; trades: TradeRecord[] }> }) {
  return (
    <div className="text-xs">
      <div className="grid grid-cols-[100px_repeat(6,1fr)] gap-2 py-1 border-b border-(--color-border) text-(--color-text-dim)">
        <div></div>
        <div className="text-right">Trades</div>
        <div className="text-right">Win %</div>
        <div className="text-right">Net</div>
        <div className="text-right">Avg win</div>
        <div className="text-right">Avg loss</div>
        <div className="text-right">PF</div>
      </div>
      {groups.map(g => {
        const s = aggregate(g.trades)
        let wins = 0
        let losses = 0
        for (const t of g.trades) {
          const p = effectivePnl(t) ?? 0
          if (p > 0) wins += p
          else if (p < 0) losses += p
        }
        const pf = losses === 0 ? (wins > 0 ? Infinity : null) : wins / Math.abs(losses)
        return (
          <div
            key={g.label}
            className="grid grid-cols-[100px_repeat(6,1fr)] gap-2 py-1.5 border-b border-(--color-border)/40 last:border-b-0 font-mono tabular-nums"
          >
            <div className="text-(--color-text-dim) font-sans">{g.label}</div>
            <div className="text-right">{s.count}</div>
            <div className="text-right">
              {s.win_rate === null ? '—' : `${Math.round(s.win_rate * 100)}%`}
            </div>
            <div
              className={cn(
                'text-right',
                s.net_pnl > 0 && 'text-(--color-win)',
                s.net_pnl < 0 && 'text-(--color-loss)',
              )}
            >
              {formatUsd(s.net_pnl)}
            </div>
            <div className="text-right text-(--color-win)">
              {s.avg_win === null ? '—' : formatUsd(s.avg_win)}
            </div>
            <div className="text-right text-(--color-loss)">
              {s.avg_loss === null ? '—' : formatUsd(s.avg_loss)}
            </div>
            <div className="text-right">
              {pf === null ? '—' : pf === Infinity ? '∞' : pf.toFixed(2)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =====================================================================
// presentational helpers
// =====================================================================

function SectionGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{children}</div>
}

function Card({
  title,
  caption,
  right,
  children,
}: {
  title: string
  caption?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-(--color-panel) rounded-(--radius) p-4 shadow-(--shadow-xs)">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div>
          <h3 className="text-sm font-medium tracking-tight">{title}</h3>
          {caption ? <div className="text-xs text-(--color-text-dim) mt-0.5">{caption}</div> : null}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Stat({
  label,
  value,
  caption,
  tone,
}: {
  label: string
  value: string
  caption?: string
  tone?: 'win' | 'loss' | 'dim'
}) {
  return (
    <div className="bg-(--color-panel-2) rounded-(--radius) p-2">
      <div className="text-xs uppercase tracking-wider text-(--color-text-dim)">
        {label}
      </div>
      <div
        className={cn(
          'text-base font-mono tabular-nums mt-1',
          tone === 'win' && 'text-(--color-win)',
          tone === 'loss' && 'text-(--color-loss)',
          tone === 'dim' && 'text-(--color-text-dim)',
        )}
      >
        {value}
      </div>
      {caption ? (
        <div className="text-xs text-(--color-text-dim) mt-0.5">{caption}</div>
      ) : null}
    </div>
  )
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2 py-0.5 rounded border transition-colors',
        active
          ? 'border-(--color-border) bg-(--color-panel-2) text-(--color-text)'
          : 'border-transparent text-(--color-text-dim) hover:text-(--color-text)',
      )}
    >
      {children}
    </button>
  )
}

interface ReportRow {
  label: string
  count: number
  wins: number
  losses: number
  pnl: number
  hideWl?: boolean
}
function ReportTable({ title, rows }: { title?: string; rows: ReportRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) text-center py-3">
        No data.
      </div>
    )
  }
  const max = Math.max(0, ...rows.map(r => Math.abs(r.pnl)))
  return (
    <div>
      {title ? <h3 className="text-sm font-medium mb-2">{title}</h3> : null}
      <div className="text-xs">
        <div className="grid grid-cols-[80px_60px_80px_1fr_80px] gap-2 py-1 border-b border-(--color-border) text-(--color-text-dim)">
          <div></div>
          <div className="text-right">Trades</div>
          <div className="text-right">W / L</div>
          <div></div>
          <div className="text-right">P&L</div>
        </div>
        {rows.map(r => {
          const intensity = max === 0 ? 0 : Math.abs(r.pnl) / max
          const tone = r.pnl > 0 ? 'var(--color-win)' : r.pnl < 0 ? 'var(--color-loss)' : 'var(--color-panel-2)'
          // Bar centered at 50% — winners go right, losers go left.
          const half = (intensity * 100) / 2
          return (
            <div
              key={r.label}
              className="grid grid-cols-[80px_60px_80px_1fr_80px] gap-2 py-1.5 border-b border-(--color-border)/40 last:border-b-0 items-center"
            >
              <div className="text-(--color-text-dim) font-mono">{r.label}</div>
              <div className="text-right font-mono">{r.count}</div>
              <div className="text-right font-mono text-xs">
                {r.hideWl ? '' : `${r.wins}/${r.losses}`}
              </div>
              <div className="relative h-2 bg-(--color-panel-2) rounded-full">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-(--color-border)" />
                <div
                  className="absolute top-0 bottom-0 rounded-full"
                  style={{
                    width: `${half}%`,
                    left: r.pnl >= 0 ? '50%' : `${50 - half}%`,
                    backgroundColor: tone,
                    opacity: 0.85,
                  }}
                />
              </div>
              <div
                className={cn(
                  'text-right font-mono tabular-nums',
                  r.pnl > 0 && 'text-(--color-win)',
                  r.pnl < 0 && 'text-(--color-loss)',
                  r.pnl === 0 && 'text-(--color-text-dim)',
                )}
              >
                {formatUsd(r.pnl)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PlannedRRTable({
  rows,
}: {
  rows: Array<{ label: string; count: number; wins: number; losses: number; pnl: number; avgRealized: number | null }>
}) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) text-center py-3">No data.</div>
    )
  }
  return (
    <div className="text-xs">
      <div className="grid grid-cols-[60px_60px_80px_80px_1fr] gap-2 py-1 border-b border-(--color-border) text-(--color-text-dim)">
        <div>Plan</div>
        <div className="text-right">Trades</div>
        <div className="text-right">Win %</div>
        <div className="text-right">Realised R</div>
        <div className="text-right">Net</div>
      </div>
      {rows.map(r => {
        const wr = r.wins + r.losses === 0 ? null : r.wins / (r.wins + r.losses)
        return (
          <div
            key={r.label}
            className="grid grid-cols-[60px_60px_80px_80px_1fr] gap-2 py-1.5 border-b border-(--color-border)/40 last:border-b-0 font-mono tabular-nums"
          >
            <div className="text-(--color-text-dim)">{r.label}</div>
            <div className="text-right">{r.count}</div>
            <div className="text-right">{wr === null ? '—' : `${Math.round(wr * 100)}%`}</div>
            <div className="text-right">
              {r.avgRealized === null ? '—' : r.avgRealized.toFixed(2)}
            </div>
            <div
              className={cn(
                'text-right',
                r.pnl > 0 && 'text-(--color-win)',
                r.pnl < 0 && 'text-(--color-loss)',
                r.pnl === 0 && 'text-(--color-text-dim)',
              )}
            >
              {formatUsd(r.pnl)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HourRow({ data }: { data: ReturnType<typeof pnlByHour> }) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.pnl)))
  return (
    <div className="grid grid-cols-12 gap-0.5">
      {data.map(d => {
        const pct = (Math.abs(d.pnl) / max) * 100
        const tone = d.pnl > 0 ? 'var(--color-win)' : d.pnl < 0 ? 'var(--color-loss)' : 'var(--color-panel-2)'
        return (
          <div key={d.hour} className="flex flex-col items-center gap-1">
            <div className="h-16 w-full flex items-end">
              <div
                className="w-full rounded-sm"
                style={{ height: `${pct}%`, backgroundColor: tone, opacity: d.count > 0 ? 0.85 : 0.15 }}
                title={`${d.hour}:00 · ${formatUsd(d.pnl)} · ${d.count} trade${d.count === 1 ? '' : 's'}`}
              />
            </div>
            <div className="text-xs font-mono text-(--color-text-dim)">
              {String(d.hour).padStart(2, '0')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HoldRow({ data }: { data: ReturnType<typeof holdTimeBuckets> }) {
  const max = Math.max(1, ...data.map(d => d.wins + d.losses))
  return (
    <div className="grid grid-flow-col auto-cols-fr gap-2 h-[160px] items-end">
      {data.map(d => {
        const total = d.wins + d.losses
        const pct = total === 0 ? 2 : (total / max) * 100
        const winPct = total === 0 ? 0 : (d.wins / total) * 100
        return (
          <div key={d.label} className="flex flex-col items-center gap-1">
            <div className="text-xs font-mono text-(--color-text-dim)">
              {total || ''}
            </div>
            <div className="w-full flex flex-col" style={{ height: `${pct}%` }}>
              <div
                style={{ height: `${winPct}%`, backgroundColor: 'var(--color-win)', opacity: 0.85 }}
                className="rounded-t-sm"
              />
              <div
                style={{ height: `${100 - winPct}%`, backgroundColor: 'var(--color-loss)', opacity: 0.85 }}
                className="rounded-b-sm"
              />
            </div>
            <div className="text-xs font-mono text-(--color-text-dim)">{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function RDistRows({ buckets }: { buckets: ReturnType<typeof rDistribution> }) {
  const max = Math.max(1, ...buckets.map(b => b.count))
  return (
    <div className="space-y-1">
      {buckets.map(b => {
        const pct = (b.count / max) * 100
        const isWin = b.range[0] >= 0
        const color = isWin ? 'var(--color-win)' : 'var(--color-loss)'
        return (
          <div key={b.label} className="grid grid-cols-[48px_1fr_28px] items-center gap-2">
            <div className="text-xs font-mono text-(--color-text-dim)">{b.label}</div>
            <div className="h-4 bg-(--color-panel-2) rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm"
                style={{ width: `${pct}%`, backgroundColor: color, opacity: b.count > 0 ? 0.8 : 0.2 }}
              />
            </div>
            <div className="text-xs font-mono text-right tabular-nums text-(--color-text-dim)">
              {b.count}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Scatter({
  points,
  onClick,
}: {
  points: ScatterPoint[]
  onClick?: (p: ScatterPoint) => void
}) {
  const W = 480
  const H = 220
  const PAD = 28
  if (points.length === 0) {
    return <div className="text-xs text-(--color-text-dim) text-center py-6">No trades.</div>
  }
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const xMax = Math.max(1, ...xs)
  const yMax = Math.max(1, ...ys.map(Math.abs))
  const x = (v: number) => PAD + (v / xMax) * (W - PAD * 2)
  const y = (v: number) => H / 2 - (v / yMax) * (H / 2 - PAD)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px]">
      <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="var(--color-border)" strokeWidth={1} />
      <line x1={PAD} x2={PAD} y1={PAD} y2={H - PAD} stroke="var(--color-border)" strokeWidth={1} />
      {points.map(p => (
        <circle
          key={p.id}
          cx={x(p.x)}
          cy={y(p.y)}
          r={3.5}
          fill={p.win ? 'var(--color-win)' : 'var(--color-loss)'}
          fillOpacity={0.7}
          stroke={p.win ? 'var(--color-win)' : 'var(--color-loss)'}
          style={{ cursor: onClick ? 'pointer' : 'default' }}
          onClick={() => onClick?.(p)}
        >
          <title>
            {p.date} · {formatUsd(p.y)} · excursion {formatUsd(p.x)}
          </title>
        </circle>
      ))}
    </svg>
  )
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
