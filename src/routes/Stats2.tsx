import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, format } from 'date-fns'
import { X } from 'lucide-react'
import type { ContractType, Rating, Session, SymbolKey, TradeRecord } from '@/db/types'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import {
  applyFilters,
  EMPTY_FILTERS,
  filtersFromParams,
  paramsFromFilters,
  type TradeFilters,
} from '@/lib/filters'
import { aggregate } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { effectivePnl } from '@/lib/trade-math'
import {
  cohortStats,
  compositeScore,
  dailyEquitySeries,
  drawdownStats,
  expectancyDollars,
  expectancyR,
  holdTimeBuckets,
  kellyFraction,
  maeMfeStats,
  maeScatter,
  mfeScatter,
  payoffRatio,
  pnlByHour,
  pnlByMonth,
  pnlByWeekday,
  profitFactor,
  rDistribution,
  ratioStats,
  sqn,
  streakStats,
  type ScatterPoint,
} from '@/lib/advanced-stats'
import { Pills } from '@/components/form/Pills'
import { Field, inputClass } from '@/components/form/Field'
import { cn } from '@/lib/utils'

const SYMBOL_OPTS = [
  { value: null, label: 'All' },
  { value: 'NQ' as const, label: 'NQ' },
  { value: 'ES' as const, label: 'ES' },
] satisfies Array<{ value: SymbolKey | null; label: string }>

const CONTRACT_OPTS = [
  { value: null, label: 'All' },
  { value: 'micro' as const, label: 'Micro' },
  { value: 'mini' as const, label: 'Mini' },
] satisfies Array<{ value: ContractType | null; label: string }>

const SESSION_OPTS = [
  { value: null, label: 'All' },
  { value: 'pre' as const, label: 'Pre' },
  { value: 'AM' as const, label: 'AM' },
  { value: 'LT' as const, label: 'LT' },
  { value: 'PM' as const, label: 'PM' },
  { value: 'aft' as const, label: 'Aft' },
] satisfies Array<{ value: Session | null; label: string }>

const RATING_OPTS = [
  { value: null, label: 'All' },
  { value: 'good' as const, label: '👍' },
  { value: 'excellent' as const, label: '🔥' },
  { value: 'egg' as const, label: '🥚' },
] satisfies Array<{ value: Rating | null; label: string }>

function defaultRange(baseDate: string) {
  const base = new Date(baseDate + 'T00:00:00')
  return {
    from: format(addDays(base, -29), 'yyyy-MM-dd'),
    to: baseDate,
  }
}

type BreakdownTab = 'symbol' | 'contract' | 'session' | 'rating' | 'weekday'
const BREAKDOWN_TABS: Array<{ value: BreakdownTab; label: string }> = [
  { value: 'symbol', label: 'Symbol' },
  { value: 'contract', label: 'Contract' },
  { value: 'session', label: 'Session' },
  { value: 'rating', label: 'Rating' },
  { value: 'weekday', label: 'Day of week' },
]

export function Stats2Route() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const urlFilters = filtersFromParams(params)
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>('symbol')
  const [scatterTab, setScatterTab] = useState<'mae' | 'mfe'>('mfe')

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

  const filtered = useMemo(
    () => applyFilters(allTrades ?? [], filters),
    [allTrades, filters],
  )
  const stats = aggregate(filtered)
  const winners = useMemo(() => filtered.filter(t => (effectivePnl(t) ?? 0) > 0), [filtered])
  const losers = useMemo(() => filtered.filter(t => (effectivePnl(t) ?? 0) < 0), [filtered])

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (filters.from && filters.to) {
      return { rangeStart: filters.from, rangeEnd: filters.to }
    }
    return { rangeStart: null, rangeEnd: null }
  }, [filters.from, filters.to])

  // ---------- advanced stats ----------------------------------------
  const days = useMemo(() => {
    if (!rangeStart || !rangeEnd) return []
    const s = new Date(rangeStart + 'T00:00:00')
    const e = new Date(rangeEnd + 'T00:00:00')
    const out: string[] = []
    const cur = new Date(s)
    while (cur <= e) {
      out.push(format(cur, 'yyyy-MM-dd'))
      cur.setDate(cur.getDate() + 1)
    }
    return out
  }, [rangeStart, rangeEnd])
  const equitySeries = useMemo(
    () => dailyEquitySeries(filtered, days, 0),
    [filtered, days],
  )
  const ddStats = useMemo(
    () => drawdownStats(equitySeries, stats.net_pnl),
    [equitySeries, stats.net_pnl],
  )
  const ratios = useMemo(
    () => ratioStats(equitySeries, ddStats.maxDdPct),
    [equitySeries, ddStats.maxDdPct],
  )
  const pf = useMemo(() => profitFactor(filtered), [filtered])
  const payoff = useMemo(() => payoffRatio(filtered), [filtered])
  const expR = useMemo(() => expectancyR(filtered), [filtered])
  const expDollars = useMemo(() => expectancyDollars(filtered), [filtered])
  const kelly = useMemo(() => kellyFraction(filtered), [filtered])
  const sqnVal = useMemo(() => sqn(filtered), [filtered])
  const streaks = useMemo(() => streakStats(filtered), [filtered])
  const maeMfe = useMemo(() => maeMfeStats(filtered), [filtered])
  const rDist = useMemo(() => rDistribution(filtered), [filtered])
  const maePoints = useMemo(() => maeScatter(filtered), [filtered])
  const mfePoints = useMemo(() => mfeScatter(filtered), [filtered])
  const hourPnl = useMemo(() => pnlByHour(filtered), [filtered])
  const weekdayPnl = useMemo(() => pnlByWeekday(filtered), [filtered])
  const monthPnl = useMemo(() => pnlByMonth(filtered), [filtered])
  const holdHist = useMemo(() => holdTimeBuckets(filtered), [filtered])
  const winnerCohort = useMemo(() => cohortStats(winners), [winners])
  const loserCohort = useMemo(() => cohortStats(losers), [losers])

  const composite = useMemo(
    () =>
      compositeScore({
        profitFactor: pf,
        payoff,
        winRate: stats.win_rate,
        maxDdPct: ddStats.maxDdPct,
        recoveryFactor: ddStats.recoveryFactor,
        dailyPnls: equitySeries.map(p => p.pnl),
        netPnl: stats.net_pnl,
      }),
    [pf, payoff, stats.win_rate, ddStats.maxDdPct, ddStats.recoveryFactor, equitySeries, stats.net_pnl],
  )

  // Daily P&L heatmap
  const dailyPnl = useMemo(() => {
    const m = new Map<string, { pnl: number; count: number }>()
    for (const t of filtered) {
      const cur = m.get(t.trade_date) ?? { pnl: 0, count: 0 }
      cur.pnl += effectivePnl(t) ?? 0
      cur.count += 1
      m.set(t.trade_date, cur)
    }
    return m
  }, [filtered])
  const heatmapMaxAbs = useMemo(() => {
    let m = 0
    for (const d of days) {
      const v = dailyPnl.get(d)?.pnl ?? 0
      if (Math.abs(v) > m) m = Math.abs(v)
    }
    return m
  }, [dailyPnl, days])

  // Breakdowns
  const breakdownGroups = useMemo<Array<{ label: string; trades: TradeRecord[] }>>(() => {
    switch (breakdownTab) {
      case 'symbol':
        return [
          { label: 'NQ', trades: filtered.filter(t => t.symbol === 'NQ') },
          { label: 'ES', trades: filtered.filter(t => t.symbol === 'ES') },
        ]
      case 'contract':
        return [
          { label: 'Micro', trades: filtered.filter(t => t.contract_type === 'micro') },
          { label: 'Mini', trades: filtered.filter(t => t.contract_type === 'mini') },
        ]
      case 'session':
        return (['pre', 'AM', 'LT', 'PM', 'aft'] as const).map(s => ({
          label: s,
          trades: filtered.filter(t => t.session === s),
        }))
      case 'rating':
        return [
          { label: '👍 good', trades: filtered.filter(t => t.rating === 'good') },
          { label: '🔥 excellent', trades: filtered.filter(t => t.rating === 'excellent') },
          { label: '🥚 egg', trades: filtered.filter(t => t.rating === 'egg') },
        ]
      case 'weekday': {
        const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const groups: Array<{ label: string; trades: TradeRecord[] }> = NAMES.map(n => ({
          label: n,
          trades: [],
        }))
        for (const t of filtered) {
          const day = new Date(t.trade_date + 'T00:00:00').getDay()
          groups[day].trades.push(t)
        }
        return groups.filter(g => (g.label !== 'Sat' && g.label !== 'Sun') || g.trades.length > 0)
      }
    }
  }, [breakdownTab, filtered])

  function update(next: Partial<TradeFilters>) {
    const d = defaultRange(lastTradeDate)
    const merged: TradeFilters = { ...urlFilters, ...next }
    if (merged.from === d.from) merged.from = null
    if (merged.to === d.to) merged.to = null
    setParams(paramsFromFilters(merged))
  }
  function clear() {
    setParams(paramsFromFilters(EMPTY_FILTERS))
  }

  const isDefault = params.toString() === ''

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Stats v2</h1>
        {!isDefault && (
          <button
            onClick={clear}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-(--radius) border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
          >
            <X className="size-3" /> Clear filters
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

      {filtered.length === 0 ? (
        <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
          {(allTrades ?? []).length === 0
            ? 'No trades yet.'
            : 'No trades match the current filters.'}
        </div>
      ) : (
        <>
          {/* Hero net P&L */}
          <section className="text-center py-6 rounded-(--radius) bg-(--color-panel) shadow-(--shadow-xs)">
            <div className="text-xs uppercase tracking-wider text-(--color-text-dim) mb-1">
              Net P&amp;L
            </div>
            <div
              className={cn(
                'text-5xl font-mono font-medium tabular-nums',
                stats.net_pnl > 0 && 'text-(--color-win)',
                stats.net_pnl < 0 && 'text-(--color-loss)',
                stats.net_pnl === 0 && 'text-(--color-text-dim)',
              )}
            >
              {formatUsd(stats.net_pnl)}
            </div>
            <div className="mt-2 text-xs text-(--color-text-dim)">
              {filtered.length} trade{filtered.length === 1 ? '' : 's'}
              {rangeStart && rangeEnd ? ` · ${rangeStart} → ${rangeEnd}` : ''}
            </div>
          </section>

          {/* Composite (Zella-style) score */}
          <CompositeScoreCard score={composite} />

          {/* KPI strip */}
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <KpiTile
              label="Win rate"
              value={stats.win_rate === null ? '—' : `${Math.round(stats.win_rate * 100)}%`}
              caption={`${stats.wins}W / ${stats.losses}L`}
            />
            <KpiTile
              label="Profit factor"
              value={pf === null ? '—' : pf === Infinity ? '∞' : pf.toFixed(2)}
            />
            <KpiTile
              label="Expectancy"
              value={expR === null ? '—' : `${expR.toFixed(2)} R`}
              caption={expDollars === null ? undefined : `${formatUsd(expDollars)} / trade`}
              tone={expR === null ? 'dim' : expR > 0 ? 'win' : expR < 0 ? 'loss' : 'dim'}
            />
            <KpiTile
              label="Avg win"
              value={stats.avg_win === null ? '—' : formatUsd(stats.avg_win)}
              tone={stats.avg_win === null ? 'dim' : 'win'}
            />
            <KpiTile
              label="Avg loss"
              value={stats.avg_loss === null ? '—' : formatUsd(stats.avg_loss)}
              tone={stats.avg_loss === null ? 'dim' : 'loss'}
            />
            <KpiTile label="Total fees" value={formatUsd(-stats.fees)} caption={`${stats.count} sides`} />
          </section>

          {/* Risk strip — every tile has a hover tooltip explaining what
             it means in plain English; the caption shows a quality band so
             you can tell at a glance if your number is good. */}
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
            <KpiTile
              label="SQN"
              value={sqnVal === null ? '—' : sqnVal.toFixed(2)}
              caption={qualSqn(sqnVal)}
              tooltip="System Quality Number (Van Tharp). Combines your edge size with consistency over the sample. Above 2 = good, above 2.5 = excellent."
            />
            <KpiTile
              label="Sharpe"
              value={ratios.sharpe === null ? '—' : ratios.sharpe.toFixed(2)}
              caption={qualSharpe(ratios.sharpe)}
              tooltip="Annualised return per unit of total daily volatility. Above 2 is great, above 3 is exceptional. Tends to inflate on small samples."
            />
            <KpiTile
              label="Sortino"
              value={ratios.sortino === null ? '—' : ratios.sortino.toFixed(2)}
              caption={qualSharpe(ratios.sortino)}
              tooltip="Like Sharpe, but only losing days hurt the score — winning-day volatility is free. Above 2 = great."
            />
            <KpiTile
              label="Calmar"
              value={ratios.calmar === null ? '—' : ratios.calmar.toFixed(2)}
              caption={qualCalmar(ratios.calmar)}
              tooltip="Annualised return divided by max drawdown. Above 3 = strong return for the pain endured."
            />
            <KpiTile
              label="Recovery"
              value={
                ddStats.recoveryFactor === null
                  ? '—'
                  : ddStats.recoveryFactor.toFixed(2)
              }
              caption={qualRecovery(ddStats.recoveryFactor)}
              tooltip="Net P&L divided by your worst drawdown. 3 = you've earned 3× your worst drawdown back."
            />
            <KpiTile
              label="Max DD"
              value={ddStats.maxDd === 0 ? '—' : formatUsd(ddStats.maxDd)}
              caption={
                ddStats.maxDdDurationDays > 0
                  ? `${ddStats.maxDdDurationDays}d underwater`
                  : undefined
              }
              tone={ddStats.maxDd === 0 ? 'dim' : 'loss'}
              tooltip="Largest peak-to-trough drop in your equity curve over this period."
            />
            <KpiTile
              label="Kelly"
              value={kelly === null ? '—' : `${Math.round(kelly * 100)}%`}
              caption={qualKelly(kelly)}
              tooltip="Theoretical optimal % of capital to risk per trade given your win rate and payoff. Use ¼ to ½ Kelly in practice — full Kelly is too volatile."
            />
          </section>

          {/* MAE / MFE sub-row */}
          <section className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <KpiTile
              label="Avg MAE"
              value={maeMfe.avgMae === null ? '—' : formatUsd(-maeMfe.avgMae)}
              caption="Worst drawdown / trade"
              tone={maeMfe.avgMae === null ? 'dim' : 'loss'}
            />
            <KpiTile
              label="Avg MFE"
              value={maeMfe.avgMfe === null ? '—' : formatUsd(maeMfe.avgMfe)}
              caption="Best favourable / trade"
              tone={maeMfe.avgMfe === null ? 'dim' : 'win'}
            />
            <KpiTile
              label="MFE efficiency"
              value={
                maeMfe.mfeEfficiency === null
                  ? '—'
                  : `${Math.round(maeMfe.mfeEfficiency * 100)}%`
              }
              caption="held-to-peak (winners)"
            />
            <KpiTile
              label="MAE / stop"
              value={
                maeMfe.maeStopRatio === null
                  ? '—'
                  : `${Math.round(maeMfe.maeStopRatio * 100)}%`
              }
              caption="losers excursion vs stop"
            />
          </section>

          {/* R-distribution + scatter */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="R-multiple distribution" caption="trades per R bucket">
              <RDistributionBars buckets={rDist} />
            </ChartCard>
            <ChartCard
              title={scatterTab === 'mfe' ? 'P&L vs MFE' : 'P&L vs MAE'}
              caption={
                scatterTab === 'mfe'
                  ? 'how much each trade gave back'
                  : 'how much each trade had to take'
              }
              right={
                <div className="flex gap-1 text-xs font-mono">
                  <ToggleBtn active={scatterTab === 'mfe'} onClick={() => setScatterTab('mfe')}>
                    MFE
                  </ToggleBtn>
                  <ToggleBtn active={scatterTab === 'mae'} onClick={() => setScatterTab('mae')}>
                    MAE
                  </ToggleBtn>
                </div>
              }
            >
              <ScatterChart
                points={scatterTab === 'mfe' ? mfePoints : maePoints}
                onClick={p => navigate(`/trade/${p.id}/edit`)}
              />
            </ChartCard>
          </section>

          {/* Time-of-day + weekday */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="P&L by hour" caption="local-time first execution">
              <HourBars data={hourPnl} />
            </ChartCard>
            <ChartCard title="P&L by weekday" caption="trades stacked wins / losses">
              <WeekdayBars data={weekdayPnl} />
            </ChartCard>
          </section>

          {/* Monthly returns + hold-time */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="Monthly returns">
              <MonthlyReturnsTable data={monthPnl} />
            </ChartCard>
            <ChartCard title="Hold time" caption="winners vs losers per bucket">
              <HoldTimeBars data={holdHist} />
            </ChartCard>
          </section>

          {/* Streak + cohort comparison */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <KpiTile
              label="Longest win streak"
              value={`${streaks.longestWin}`}
              caption="consecutive winners"
              tone={streaks.longestWin > 0 ? 'win' : 'dim'}
            />
            <KpiTile
              label="Longest loss streak"
              value={`${streaks.longestLoss}`}
              caption="consecutive losers"
              tone={streaks.longestLoss > 0 ? 'loss' : 'dim'}
            />
            <KpiTile
              label="Current streak"
              value={
                streaks.current === 0
                  ? '—'
                  : `${streaks.current > 0 ? '+' : ''}${streaks.current}`
              }
              tone={
                streaks.current > 0 ? 'win' : streaks.current < 0 ? 'loss' : 'dim'
              }
            />
            <KpiTile
              label="Ulcer Index"
              value={ddStats.ulcerIndex.toFixed(2)}
              caption={qualUlcer(ddStats.ulcerIndex)}
              tooltip="Pain index. Squared average of percentage drawdowns over the period — higher = deeper or longer underwater stretches. 0 = no drawdowns."
            />
          </section>

          <CohortCompareCard winners={winnerCohort} losers={loserCohort} />

          {/* Daily P&L heatmap */}
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Daily P&amp;L</h2>
            <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3">
              <div className="grid gap-1 grid-cols-[repeat(auto-fill,minmax(28px,1fr))]">
                {days.map(d => {
                  const cell = dailyPnl.get(d)
                  const pnl = cell?.pnl ?? 0
                  const intensity = heatmapMaxAbs > 0 ? Math.abs(pnl) / heatmapMaxAbs : 0
                  const bg = !cell
                    ? 'transparent'
                    : pnl > 0
                      ? `color-mix(in oklab, var(--color-win) ${10 + intensity * 70}%, transparent)`
                      : pnl < 0
                        ? `color-mix(in oklab, var(--color-loss) ${10 + intensity * 70}%, transparent)`
                        : 'var(--color-panel-2)'
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => navigate(`/day/${d}`)}
                      title={`${d} · ${formatUsd(pnl)} · ${cell?.count ?? 0} trade${(cell?.count ?? 0) === 1 ? '' : 's'}`}
                      className="aspect-square rounded-sm text-xs font-mono text-(--color-text-dim) hover:opacity-80 transition-opacity"
                      style={{ backgroundColor: bg }}
                    >
                      {format(new Date(d + 'T00:00:00'), 'd')}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Tabbed breakdowns */}
          <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-3">
            <Pills
              value={breakdownTab}
              onChange={setBreakdownTab}
              options={BREAKDOWN_TABS}
              size="sm"
            />
            <BreakdownTable groups={breakdownGroups} />
          </section>
        </>
      )}
    </div>
  )
}

// ============================================================================
// presentational helpers
// ============================================================================

interface KpiTileProps {
  label: string
  value: string
  caption?: string
  tone?: 'win' | 'loss' | 'dim'
  /** Plain-English explanation of the metric, shown on hover. */
  tooltip?: string
}
function KpiTile({ label, value, caption, tone, tooltip }: KpiTileProps) {
  return (
    <div
      className={cn(
        'bg-(--color-panel) rounded-(--radius) p-3.5 shadow-(--shadow-xs)',
        'transition-colors hover:border-(--color-border-strong)',
        tooltip && 'cursor-help',
      )}
      title={tooltip}
    >
      <div className="text-xs uppercase tracking-[0.08em] font-medium text-(--color-text-dim)">
        {label}
      </div>
      <div
        className={cn(
          'text-xl font-mono font-medium tabular-nums mt-1.5',
          tone === 'win' && 'text-(--color-win)',
          tone === 'loss' && 'text-(--color-loss)',
          tone === 'dim' && 'text-(--color-text-dim)',
        )}
      >
        {value}
      </div>
      {caption ? (
        <div className="text-xs text-(--color-text-dim) mt-1">{caption}</div>
      ) : null}
    </div>
  )
}

interface ChartCardProps {
  title: string
  caption?: string
  right?: React.ReactNode
  children: React.ReactNode
}
function ChartCard({ title, caption, right, children }: ChartCardProps) {
  return (
    <div className="bg-(--color-panel) rounded-(--radius) p-4 shadow-(--shadow-xs)">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div>
          <h3 className="text-sm font-medium tracking-tight">{title}</h3>
          {caption ? (
            <div className="text-xs text-(--color-text-dim) mt-0.5">{caption}</div>
          ) : null}
        </div>
        {right}
      </div>
      {children}
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

// ----- composite score (Zella) -----------------------------------------

function CompositeScoreCard({ score }: { score: ReturnType<typeof compositeScore> }) {
  const parts: Array<{ key: keyof typeof score.parts; label: string; weight: number }> = [
    { key: 'profitFactor', label: 'Profit factor', weight: 25 },
    { key: 'payoff', label: 'Avg win / loss', weight: 20 },
    { key: 'maxDd', label: 'Max drawdown', weight: 20 },
    { key: 'winRate', label: 'Win %', weight: 15 },
    { key: 'recovery', label: 'Recovery', weight: 10 },
    { key: 'consistency', label: 'Consistency', weight: 10 },
  ]
  const total = Math.round(score.total)
  const tone = total >= 70 ? 'win' : total >= 40 ? 'dim' : 'loss'
  return (
    <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-4">
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4 items-center">
        <div className="text-center sm:text-left">
          <div className="text-xs uppercase tracking-wider text-(--color-text-dim)">
            Composite score
          </div>
          <div
            className={cn(
              'text-5xl font-mono font-medium tabular-nums',
              tone === 'win' && 'text-(--color-win)',
              tone === 'loss' && 'text-(--color-loss)',
              tone === 'dim' && 'text-(--color-text)',
            )}
          >
            {total}
          </div>
          <div className="text-xs text-(--color-text-dim)">/ 100</div>
        </div>
        <div className="space-y-1.5">
          {parts.map(p => {
            const v = score.parts[p.key]
            const pct = Math.max(0, Math.min(100, v))
            const partTone = pct >= 70 ? 'var(--color-win)' : pct >= 40 ? 'var(--color-text-dim)' : 'var(--color-loss)'
            return (
              <div key={p.key} className="grid grid-cols-[140px_1fr_56px] items-center gap-3">
                <div className="text-xs text-(--color-text-dim)">{p.label}</div>
                <div className="h-2 rounded-full bg-(--color-panel-2) overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: partTone }}
                  />
                </div>
                <div className="text-xs font-mono text-right tabular-nums text-(--color-text-dim)">
                  {Math.round(v)}
                  <span className="text-xs ml-1">×{p.weight}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// Quality-band helpers — return a one-word verdict ("good", "weak", etc.)
// for each of the risk metrics. Captions on KpiTile use these so the user
// can tell at a glance whether their number is good without memorising the
// scale for every metric.
function qualSqn(v: number | null): string | undefined {
  if (v === null) return undefined
  if (v < 1.6) return 'below average'
  if (v < 2) return 'average'
  if (v < 2.5) return 'good'
  if (v < 3) return 'excellent'
  if (v < 5) return 'superb'
  return 'holy grail'
}
// Sharpe and Sortino share the same scale here — Sortino just usually
// produces higher numbers for the same system because it ignores upside
// volatility.
function qualSharpe(v: number | null): string | undefined {
  if (v === null) return undefined
  if (v < 0) return 'negative'
  if (v < 1) return 'weak'
  if (v < 2) return 'ok'
  if (v < 3) return 'great'
  return 'excellent'
}
function qualCalmar(v: number | null): string | undefined {
  if (v === null) return undefined
  if (v < 0) return 'losing'
  if (v < 1) return 'weak'
  if (v < 3) return 'good'
  if (v < 5) return 'great'
  return 'excellent'
}
function qualRecovery(v: number | null): string | undefined {
  if (v === null) return undefined
  if (v < 0) return 'net loss'
  if (v < 1) return 'not recovered'
  if (v < 2) return 'ok'
  if (v < 3) return 'good'
  return 'excellent'
}
function qualKelly(v: number | null): string | undefined {
  if (v === null) return undefined
  if (v <= 0) return 'no edge'
  if (v < 0.15) return 'small edge'
  if (v < 0.3) return 'moderate'
  if (v < 0.5) return 'large'
  return 'use ¼–½ in practice'
}
function qualUlcer(v: number): string {
  if (v < 1) return 'smooth'
  if (v < 3) return 'mild'
  if (v < 6) return 'painful'
  return 'severe'
}

// ----- R distribution bars -----------------------------------------

function RDistributionBars({
  buckets,
}: {
  buckets: ReturnType<typeof rDistribution>
}) {
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

// ----- scatter chart -----------------------------------------

function ScatterChart({
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
    return (
      <div className="text-xs text-(--color-text-dim) text-center py-6">
        No trades to plot.
      </div>
    )
  }
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const xMax = Math.max(1, ...xs)
  const yMax = Math.max(1, ...ys.map(Math.abs))
  const x = (v: number) => PAD + (v / xMax) * (W - PAD * 2)
  // y is centered at H/2; positive up.
  const y = (v: number) => H / 2 - (v / yMax) * (H / 2 - PAD)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[220px]">
      {/* axis lines */}
      <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="var(--color-border)" strokeWidth={1} />
      <line x1={PAD} x2={PAD} y1={PAD} y2={H - PAD} stroke="var(--color-border)" strokeWidth={1} />
      {/* axis labels */}
      <text x={PAD} y={H - 4} fontSize={12} fill="var(--color-text-dim)" fontFamily="var(--font-mono)">
        0
      </text>
      <text
        x={W - PAD}
        y={H - 4}
        fontSize={12}
        textAnchor="end"
        fill="var(--color-text-dim)"
        fontFamily="var(--font-mono)"
      >
        {formatUsd(xMax)}
      </text>
      <text x={PAD + 2} y={PAD + 8} fontSize={12} fill="var(--color-text-dim)" fontFamily="var(--font-mono)">
        {formatUsd(yMax)}
      </text>
      <text
        x={PAD + 2}
        y={H - PAD + 4}
        fontSize={12}
        fill="var(--color-text-dim)"
        fontFamily="var(--font-mono)"
      >
        {formatUsd(-yMax)}
      </text>
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

// ----- hour P&L bars -----------------------------------------

function HourBars({ data }: { data: ReturnType<typeof pnlByHour> }) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.pnl)))
  return (
    <div className="grid grid-cols-12 gap-1">
      {data.map(d => {
        const pct = (Math.abs(d.pnl) / max) * 100
        const tone = d.pnl > 0 ? 'var(--color-win)' : d.pnl < 0 ? 'var(--color-loss)' : 'var(--color-panel-2)'
        return (
          <div key={d.hour} className="flex flex-col items-center gap-1">
            <div className="h-12 w-full flex items-end">
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

// ----- weekday bars (stacked wins/losses) -----------------------------------------

function WeekdayBars({ data }: { data: ReturnType<typeof pnlByWeekday> }) {
  const max = Math.max(1, ...data.map(d => d.wins + d.losses))
  // Drop weekends if empty for cleanliness.
  const trimmed = data.filter(
    (d, i) => (i !== 0 && i !== 6) || d.count > 0,
  )
  return (
    <div className="grid grid-flow-col auto-cols-fr gap-2 h-[180px] items-end">
      {trimmed.map(d => {
        const total = d.wins + d.losses
        const pct = total === 0 ? 0 : (total / max) * 100
        const winPct = total === 0 ? 0 : (d.wins / total) * 100
        return (
          <div key={d.name} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'font-mono text-xs tabular-nums',
                d.pnl > 0 && 'text-(--color-win)',
                d.pnl < 0 && 'text-(--color-loss)',
                d.pnl === 0 && 'text-(--color-text-dim)',
              )}
            >
              {formatUsd(d.pnl)}
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
            <div className="text-xs font-mono text-(--color-text-dim)">{d.name}</div>
          </div>
        )
      })}
    </div>
  )
}

// ----- monthly returns table -----------------------------------------

function MonthlyReturnsTable({ data }: { data: ReturnType<typeof pnlByMonth> }) {
  // Build year × month grid, only including years that have any data.
  if (data.length === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) text-center py-6">No data.</div>
    )
  }
  const map = new Map<string, number>()
  let max = 0
  for (const m of data) {
    map.set(m.month, m.pnl)
    if (Math.abs(m.pnl) > max) max = Math.abs(m.pnl)
  }
  const years = Array.from(new Set(data.map(d => d.month.slice(0, 4)))).sort()
  const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono tabular-nums">
        <thead>
          <tr className="text-(--color-text-dim)">
            <th className="text-left py-1 pr-2">Year</th>
            {monthAbbr.map(m => (
              <th key={m} className="text-right py-1 px-1">
                {m}
              </th>
            ))}
            <th className="text-right py-1 pl-2">YTD</th>
          </tr>
        </thead>
        <tbody>
          {years.map(y => {
            let ytd = 0
            return (
              <tr key={y} className="border-t border-(--color-border)/60">
                <td className="py-1 pr-2 text-(--color-text-dim)">{y}</td>
                {monthAbbr.map((_, i) => {
                  const key = `${y}-${String(i + 1).padStart(2, '0')}`
                  const v = map.get(key)
                  if (v !== undefined) ytd += v
                  const intensity = v === undefined || max === 0 ? 0 : Math.abs(v) / max
                  const bg =
                    v === undefined
                      ? 'transparent'
                      : v > 0
                        ? `color-mix(in oklab, var(--color-win) ${10 + intensity * 60}%, transparent)`
                        : v < 0
                          ? `color-mix(in oklab, var(--color-loss) ${10 + intensity * 60}%, transparent)`
                          : 'var(--color-panel-2)'
                  return (
                    <td
                      key={key}
                      className={cn(
                        'text-right py-1 px-1 rounded-sm',
                        v === undefined && 'text-(--color-text-dim)/40',
                        v !== undefined && v > 0 && 'text-(--color-win)',
                        v !== undefined && v < 0 && 'text-(--color-loss)',
                      )}
                      style={{ backgroundColor: bg }}
                    >
                      {v === undefined ? '·' : compactUsd(v)}
                    </td>
                  )
                })}
                <td
                  className={cn(
                    'py-1 pl-2 text-right',
                    ytd > 0 && 'text-(--color-win)',
                    ytd < 0 && 'text-(--color-loss)',
                    ytd === 0 && 'text-(--color-text-dim)',
                  )}
                >
                  {compactUsd(ytd)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function compactUsd(v: number): string {
  if (v === 0) return '$0'
  const abs = Math.abs(v)
  if (abs >= 1000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  return `${v < 0 ? '-' : ''}$${Math.round(abs)}`
}

// ----- hold-time histogram -----------------------------------------

function HoldTimeBars({ data }: { data: ReturnType<typeof holdTimeBuckets> }) {
  const max = Math.max(1, ...data.map(d => d.wins + d.losses))
  return (
    <div className="grid grid-flow-col auto-cols-fr gap-2 h-[180px] items-end">
      {data.map(d => {
        const total = d.wins + d.losses
        const pct = total === 0 ? 2 : (total / max) * 100
        const winPct = total === 0 ? 0 : (d.wins / total) * 100
        return (
          <div key={d.label} className="flex flex-col items-center gap-1">
            <div className="text-xs font-mono text-(--color-text-dim)">{total || ''}</div>
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

// ----- cohort compare (winners vs losers) -----------------------------------------

function CohortCompareCard({
  winners,
  losers,
}: {
  winners: ReturnType<typeof cohortStats>
  losers: ReturnType<typeof cohortStats>
}) {
  if (winners.count === 0 && losers.count === 0) return null
  const rows: Array<{
    label: string
    w: string
    l: string
  }> = [
    {
      label: 'Trades',
      w: `${winners.count}`,
      l: `${losers.count}`,
    },
    {
      label: 'Avg realised R',
      w: winners.avgRr === null ? '—' : winners.avgRr.toFixed(2),
      l: losers.avgRr === null ? '—' : losers.avgRr.toFixed(2),
    },
    {
      label: 'Avg duration',
      w: fmtDuration(winners.avgDuration_ms),
      l: fmtDuration(losers.avgDuration_ms),
    },
    {
      label: 'Avg MAE',
      w: winners.avgMae === null ? '—' : formatUsd(-winners.avgMae),
      l: losers.avgMae === null ? '—' : formatUsd(-losers.avgMae),
    },
    {
      label: 'Avg MFE',
      w: winners.avgMfe === null ? '—' : formatUsd(winners.avgMfe),
      l: losers.avgMfe === null ? '—' : formatUsd(losers.avgMfe),
    },
    {
      label: 'Avg fees',
      w: formatUsd(-winners.avgFees),
      l: formatUsd(-losers.avgFees),
    },
  ]
  return (
    <ChartCard title="Winners vs losers" caption="how the two cohorts behaved differently">
      <div className="text-xs">
        <div className="grid grid-cols-[1fr_120px_120px] gap-2 text-(--color-text-dim) py-1 border-b border-(--color-border)">
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
    </ChartCard>
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

// ----- breakdown table (kept from prior version) ---------------------

interface BreakdownTableProps {
  groups: Array<{ label: string; trades: TradeRecord[] }>
}
function BreakdownTable({ groups }: BreakdownTableProps) {
  const rows = groups.filter(g => g.trades.length > 0)
  if (rows.length === 0) {
    return (
      <div className="text-sm text-(--color-text-dim) text-center py-4">
        Nothing to break down.
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {rows.map(g => {
        const s = aggregate(g.trades)
        return (
          <div
            key={g.label}
            className="grid grid-cols-[140px_1fr_auto_auto_auto] items-center gap-3 text-sm"
          >
            <div className="font-mono text-(--color-text-dim)">{g.label}</div>
            <div className="text-xs text-(--color-text-dim)">
              {s.count} trade{s.count === 1 ? '' : 's'} ·{' '}
              {s.win_rate === null ? '—' : `${Math.round(s.win_rate * 100)}% win`}
            </div>
            <div className="font-mono text-xs text-(--color-text-dim)">
              {s.wins}W / {s.losses}L
            </div>
            <div className="font-mono text-xs text-(--color-text-dim)">
              fees {formatUsd(-s.fees)}
            </div>
            <div
              className={cn(
                'font-mono tabular-nums text-right min-w-[6rem]',
                s.net_pnl > 0 && 'text-(--color-win)',
                s.net_pnl < 0 && 'text-(--color-loss)',
                s.net_pnl === 0 && 'text-(--color-text-dim)',
              )}
            >
              {formatUsd(s.net_pnl)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
