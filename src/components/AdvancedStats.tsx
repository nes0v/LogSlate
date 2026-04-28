import { useMemo } from 'react'
import { format } from 'date-fns'
import { DonutChart } from '@/components/DonutChart'
import { aggregate } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { classifyTrade, effectivePnl, inferSide } from '@/lib/trade-math'
import { cn } from '@/lib/utils'
import type { Session, TradeRecord } from '@/db/types'
import {
  compositeScore,
  dailyEquitySeries,
  drawdownStats,
  expectancyDollars,
  expectancyR,
  kellyFraction,
  maeMfeStats,
  payoffRatio,
  profitFactor,
  ratioStats,
  sqn,
  streakStats,
} from '@/lib/advanced-stats'

function buildDayRange(rangeStart: string | null, rangeEnd: string | null): string[] {
  if (!rangeStart || !rangeEnd) return []
  const out: string[] = []
  const cur = new Date(rangeStart + 'T00:00:00')
  const end = new Date(rangeEnd + 'T00:00:00')
  while (cur <= end) {
    out.push(format(cur, 'yyyy-MM-dd'))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function HeroNetPnl({
  filtered,
  rangeStart,
  rangeEnd,
}: {
  filtered: TradeRecord[]
  rangeStart: string | null
  rangeEnd: string | null
}) {
  const stats = useMemo(() => aggregate(filtered), [filtered])
  const fmtDate = (iso: string) =>
    format(new Date(iso + 'T00:00:00'), 'dd-MMM-yyyy').toLowerCase()
  return (
    <section className="flex flex-col gap-2 h-full">
      <h2 className="text-sm font-medium">Net PNL</h2>
      <div className="flex-1 flex flex-col items-center justify-center text-center py-6 rounded-(--radius) bg-(--color-panel) shadow-(--shadow-xs)">
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
        <div className="mt-3 text-xs text-(--color-text-dim) space-y-1.5">
          {rangeStart && rangeEnd && (
            <div>
              {fmtDate(rangeStart)} to {fmtDate(rangeEnd)}
            </div>
          )}
          <div>
            {filtered.length} trade{filtered.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    </section>
  )
}

export function DistributionDonuts({ filtered }: { filtered: TradeRecord[] }) {
  const outcomeDonut = useMemo(() => {
    let win = 0, loss = 0, be = 0
    for (const t of filtered) {
      const o = classifyTrade(t)
      if (o === 'win') win++
      else if (o === 'loss') loss++
      else be++
    }
    return [
      { label: 'Wins', value: win, color: 'var(--color-win)' },
      { label: 'Losses', value: loss, color: 'var(--color-loss)' },
      { label: 'Breakeven', value: be, color: 'var(--color-chart-muted)' },
    ]
  }, [filtered])

  const sessionDonut = useMemo(() => {
    const counts = { pre: 0, AM: 0, LT: 0, PM: 0, aft: 0 } as Record<Session, number>
    for (const t of filtered) counts[t.session]++
    return [
      { label: 'pre', value: counts.pre, color: '#c4b5fd' },
      { label: 'AM', value: counts.AM, color: '#7dd3fc' },
      { label: 'LT', value: counts.LT, color: '#fbbf24' },
      { label: 'PM', value: counts.PM, color: '#2563eb' },
      { label: 'aft', value: counts.aft, color: '#7e22ce' },
    ]
  }, [filtered])

  const symbolDonut = useMemo(() => {
    let nq = 0, es = 0
    for (const t of filtered) {
      if (t.symbol === 'NQ') nq++
      else es++
    }
    return [
      { label: 'NQ', value: nq, color: 'var(--color-accent)' },
      { label: 'ES', value: es, color: 'var(--color-chart-muted)' },
    ]
  }, [filtered])

  const contractDonut = useMemo(() => {
    let micro = 0, mini = 0
    for (const t of filtered) {
      if (t.contract_type === 'micro') micro++
      else mini++
    }
    return [
      { label: 'micro', value: micro, color: 'var(--color-accent)' },
      { label: 'mini', value: mini, color: 'var(--color-chart-muted)' },
    ]
  }, [filtered])

  const sideDonut = useMemo(() => {
    let longs = 0, shorts = 0, unknown = 0
    for (const t of filtered) {
      const s = inferSide(t)
      if (s === 'long') longs++
      else if (s === 'short') shorts++
      else unknown++
    }
    return [
      { label: 'Long', value: longs, color: 'var(--color-win)' },
      { label: 'Short', value: shorts, color: 'var(--color-loss)' },
      ...(unknown > 0
        ? [{ label: 'Unknown', value: unknown, color: 'var(--color-chart-muted)' }]
        : []),
    ]
  }, [filtered])

  const ratingDonut = useMemo(() => {
    let good = 0, excellent = 0, egg = 0
    for (const t of filtered) {
      if (t.rating === 'good') good++
      else if (t.rating === 'excellent') excellent++
      else if (t.rating === 'egg') egg++
    }
    return [
      { label: 'A', value: excellent, color: 'var(--color-win)' },
      { label: 'B', value: good, color: 'var(--color-accent)' },
      { label: 'C', value: egg, color: 'var(--color-chart-muted)' },
    ]
  }, [filtered])

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Distributions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <DonutChart title="Outcomes" segments={outcomeDonut} />
        <DonutChart title="Sessions" segments={sessionDonut} />
        <DonutChart title="Symbols" segments={symbolDonut} />
        <DonutChart title="Contract type" segments={contractDonut} />
        <DonutChart title="Side" segments={sideDonut} />
        <DonutChart title="Ratings" segments={ratingDonut} />
      </div>
    </section>
  )
}

export function CompositeScoreSection({
  filtered,
  rangeStart,
  rangeEnd,
}: {
  filtered: TradeRecord[]
  rangeStart: string | null
  rangeEnd: string | null
}) {
  const stats = useMemo(() => aggregate(filtered), [filtered])
  const days = useMemo(() => buildDayRange(rangeStart, rangeEnd), [rangeStart, rangeEnd])
  const equitySeries = useMemo(() => dailyEquitySeries(filtered, days, 0), [filtered, days])
  const ddStats = useMemo(() => drawdownStats(equitySeries, stats.net_pnl), [equitySeries, stats.net_pnl])
  const pf = useMemo(() => profitFactor(filtered), [filtered])
  const payoff = useMemo(() => payoffRatio(filtered), [filtered])

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

  return <CompositeScoreCard score={composite} />
}

export function AdvancedMetricsSections({
  filtered,
  rangeStart,
  rangeEnd,
  onDayClick,
}: {
  filtered: TradeRecord[]
  rangeStart: string | null
  rangeEnd: string | null
  onDayClick?: (date: string) => void
}) {
  const stats = useMemo(() => aggregate(filtered), [filtered])
  const days = useMemo(() => buildDayRange(rangeStart, rangeEnd), [rangeStart, rangeEnd])
  const equitySeries = useMemo(() => dailyEquitySeries(filtered, days, 0), [filtered, days])
  const ddStats = useMemo(() => drawdownStats(equitySeries, stats.net_pnl), [equitySeries, stats.net_pnl])
  const ratios = useMemo(() => ratioStats(equitySeries, ddStats.maxDdPct), [equitySeries, ddStats.maxDdPct])
  const pf = useMemo(() => profitFactor(filtered), [filtered])
  const expR = useMemo(() => expectancyR(filtered), [filtered])
  const expDollars = useMemo(() => expectancyDollars(filtered), [filtered])
  const kelly = useMemo(() => kellyFraction(filtered), [filtered])
  const sqnVal = useMemo(() => sqn(filtered), [filtered])
  const streaks = useMemo(() => streakStats(filtered), [filtered])
  const maeMfe = useMemo(() => maeMfeStats(filtered), [filtered])

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

  return (
    <>
      {/* KPI strip + risk strip share a tighter vertical rhythm so they read
          as a single block of metrics, separate from the rows below. */}
      <div className="space-y-2">
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
          value={ddStats.recoveryFactor === null ? '—' : ddStats.recoveryFactor.toFixed(2)}
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
      </div>

      <div className="space-y-3">
      <section className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
          tone={streaks.current > 0 ? 'win' : streaks.current < 0 ? 'loss' : 'dim'}
        />
        <KpiTile
          label="Ulcer Index"
          value={ddStats.ulcerIndex.toFixed(2)}
          caption={qualUlcer(ddStats.ulcerIndex)}
          tooltip="Pain index. Squared average of percentage drawdowns over the period — higher = deeper or longer underwater stretches. 0 = no drawdowns."
        />
      </section>
      </div>

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
                  onClick={() => onDayClick?.(d)}
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
    </>
  )
}

interface KpiTileProps {
  label: string
  value: string
  caption?: string
  tone?: 'win' | 'loss' | 'dim'
  tooltip?: string
}
function KpiTile({ label, value, caption, tone, tooltip }: KpiTileProps) {
  return (
    <div
      className={cn(
        'bg-(--color-panel) rounded-(--radius) p-3 shadow-(--shadow-xs)',
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

function CompositeScoreCard({ score }: { score: ReturnType<typeof compositeScore> }) {
  // Order around the hexagon, clockwise starting at the top vertex.
  const parts: Array<{ key: keyof typeof score.parts; label: string; weight: number }> = [
    { key: 'winRate', label: 'win %', weight: 15 },
    { key: 'profitFactor', label: 'profit factor', weight: 25 },
    { key: 'payoff', label: 'win / loss', weight: 20 },
    { key: 'recovery', label: 'recovery', weight: 10 },
    { key: 'maxDd', label: 'max drawdown', weight: 20 },
    { key: 'consistency', label: 'consistency', weight: 10 },
  ]
  const total = Math.round(score.total)
  const tone = total >= 70 ? 'win' : total >= 40 ? 'dim' : 'loss'
  const fillColor =
    tone === 'win'
      ? 'var(--color-win)'
      : tone === 'loss'
        ? 'var(--color-loss)'
        : 'var(--color-accent)'

  // Hex chart geometry. Center is at (C, C) inside a 520×520 origin space;
  // the rendered viewBox is cropped tightly around the hex + labels.
  const C = 260
  const R = 110
  const LABEL_R = R + 22
  const LABEL_FONT = 13
  const VB_X = 10
  const VB_Y = 105
  const VB_W = 500
  const VB_H = 310

  const angles = parts.map((_, i) => -Math.PI / 2 + i * (Math.PI / 3))
  const point = (a: number, d: number) => ({
    x: C + Math.cos(a) * d,
    y: C + Math.sin(a) * d,
  })
  const polyPath = (frac: number) =>
    angles
      .map((a, i) => {
        const p = point(a, R * frac)
        return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`
      })
      .join(' ') + ' Z'
  const valuePath = parts
    .map((p, i) => {
      const pct = Math.max(0, Math.min(100, score.parts[p.key])) / 100
      const pt = point(angles[i], R * pct)
      return `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
    })
    .join(' ') + ' Z'

  return (
    <section className="flex flex-col gap-2 h-full">
      <h2 className="text-sm font-medium">Composite score</h2>
      <div className="flex-1 flex items-center justify-center bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-4">
        <div
          className="relative mx-auto w-full max-w-[520px]"
          style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
        >
          <svg
            viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
            className="absolute inset-0 w-full h-full"
          >
            {[0.25, 0.5, 0.75, 1].map(f => (
              <path
                key={f}
                d={polyPath(f)}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeOpacity={f === 1 ? 0.7 : 0.35}
              />
            ))}
            {angles.map((a, i) => {
              const p = point(a, R)
              return (
                <line
                  key={i}
                  x1={C}
                  y1={C}
                  x2={p.x}
                  y2={p.y}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                  strokeOpacity={0.35}
                />
              )
            })}
            <path d={valuePath} fill={fillColor} fillOpacity={0.22} />
            {parts.map((p, i) => {
              const pct = Math.max(0, Math.min(100, score.parts[p.key])) / 100
              const pt = point(angles[i], R * pct)
              return (
                <g key={p.key}>
                  <circle cx={pt.x} cy={pt.y} r={5} fill={fillColor} />
                  <circle cx={pt.x} cy={pt.y} r={2} fill="white" />
                </g>
              )
            })}
            {parts.map((p, i) => {
              const v = Math.round(score.parts[p.key])
              const lp = point(angles[i], LABEL_R)
              const cosA = Math.cos(angles[i])
              const anchor = Math.abs(cosA) < 0.3 ? 'middle' : cosA > 0 ? 'start' : 'end'
              return (
                <text
                  key={p.key}
                  x={lp.x}
                  y={lp.y}
                  dominantBaseline="middle"
                  textAnchor={anchor}
                  fontSize={LABEL_FONT}
                >
                  <tspan fill="var(--color-text-dim)">{p.label}</tspan>
                  <tspan
                    dx={6}
                    fill="var(--color-text-dim)"
                    fontFamily="var(--font-mono)"
                  >
                    ({v})
                  </tspan>
                </text>
              )
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div
              className={cn(
                'text-5xl font-mono font-medium tabular-nums leading-none',
                tone === 'win' && 'text-(--color-win)',
                tone === 'loss' && 'text-(--color-loss)',
                tone === 'dim' && 'text-(--color-text)',
              )}
            >
              {total}
            </div>
            <div className="text-xs text-(--color-text-dim) mt-1">/ 100</div>
          </div>
        </div>
      </div>
    </section>
  )
}

function qualSqn(v: number | null): string | undefined {
  if (v === null) return undefined
  if (v < 1.6) return 'below average'
  if (v < 2) return 'average'
  if (v < 2.5) return 'good'
  if (v < 3) return 'excellent'
  if (v < 5) return 'superb'
  return 'holy grail'
}
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
