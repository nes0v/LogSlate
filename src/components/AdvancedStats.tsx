import { Children, memo, useMemo } from 'react'
import { eachDayOfInterval, format, parseISO } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { DonutChart } from '@/components/DonutChart'
import { RatingStars } from '@/components/RatingStars'
import { listModels } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import type { AggregateStats } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { classifyTrade } from '@/lib/trade-math'
import { HOLD_BUCKETS, holdBucketOf } from '@/lib/filters'
import { cn } from '@/lib/utils'
import type { Session, TradeRecord } from '@/db/types'
import { EMOTIONS, DEFAULT_MODEL_NAME } from '@/db/types'
import { SESSION_BG } from '@/lib/session-colors'
import {
  compositeScore,
  dailyEquitySeries,
  dailyStats,
  drawdownStats,
  expectancyDollars,
  expectancyR,
  extremeStats,
  maeMfeStats,
  payoffRatio,
  profitFactor,
  ratioStats,
  sqn,
  streakStats,
} from '@/lib/advanced-stats'

function buildDayRange(rangeStart: string | null, rangeEnd: string | null): string[] {
  if (!rangeStart || !rangeEnd) return []
  return eachDayOfInterval({
    start: parseISO(rangeStart),
    end: parseISO(rangeEnd),
  }).map(d => format(d, 'yyyy-MM-dd'))
}

export const HeroNetPnl = memo(function HeroNetPnl({
  stats,
}: {
  stats: AggregateStats
}) {
  return (
    <section className="flex flex-col gap-2 h-full">
      <h2 className="text-sm font-medium">Net PNL</h2>
      <div className="flex-1 flex flex-col items-center justify-center text-center py-6 rounded-(--radius) bg-(--color-panel) shadow-(--shadow-drop-xs)">
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
        {stats.fees > 0 && (
          <div className="mt-3 text-sm text-(--color-text-dim)">
            <span className="text-(--color-text)">
              {formatUsd(-stats.fees)}
            </span>{' '}
            fees
          </div>
        )}
      </div>
    </section>
  )
})

// One distinct hue per emotion. Greens lean to the steady/positive end;
// reds/ambers/purples to the agitated/negative end; greys to neutral
// states — but the legend label is the authoritative signal.
const EMOTION_COLORS: Record<(typeof EMOTIONS)[number], string> = {
  calm: '#10b981',
  focused: '#34d399',
  anxious: '#f59e0b',
  fearful: '#fb7185',
  FOMO: '#f97316',
  impatient: '#ec4899',
  frustrated: '#ef4444',
  tired: '#9ca3af',
  greedy: '#a855f7',
  busy: '#06b6d4',
}

// Hold-time gradient — quick scalps (cool blues) → long holds (warm
// oranges). 8 stops, one per HOLD_BUCKETS entry; index-aligned.
const HOLD_PALETTE: Record<(typeof HOLD_BUCKETS)[number], string> = {
  '<1m': '#60a5fa',
  '1-5m': '#38bdf8',
  '5-15m': '#22d3ee',
  '15-30m': '#34d399',
  '30-60m': '#facc15',
  '1-2h': '#fb923c',
  '2-4h': '#f97316',
  '4h+': '#ef4444',
}

// Palette for the model donut. Cycled by index when the user has more
// models than colors — at 8 entries that should never realistically wrap.
const MODEL_PALETTE = [
  'var(--color-accent)',
  '#7dd3fc',
  '#fbbf24',
  '#c4b5fd',
  '#f472b6',
  '#34d399',
  '#fb923c',
  '#60a5fa',
]

export const DistributionDonuts = memo(function DistributionDonuts({
  filtered,
}: {
  filtered: TradeRecord[]
}) {
  const accountId = useActiveAccountId()
  const models = useLiveQuery(
    () => listModels(accountId),
    [accountId],
    [],
  )
  // One pass over `filtered` populates every donut's counts. Previously
  // each donut had its own useMemo with its own loop — at 6 donuts and N
  // trades that's 6N work plus per-trade `classifyTrade` / `holdBucketOf`
  // calls (which are themselves O(executions) without their own caches).
  // Single-pass keeps everything to N.
  const donutCounts = useMemo(() => {
    let win = 0, loss = 0, be = 0
    let good = 0, excellent = 0, poor = 0
    const session: Record<Session, number> = { pre: 0, am: 0, lunch: 0, pm: 0, aft: 0 }
    const hold = Object.fromEntries(HOLD_BUCKETS.map(b => [b, 0])) as Record<
      (typeof HOLD_BUCKETS)[number],
      number
    >
    let holdUnknown = 0
    const emotion = Object.fromEntries(EMOTIONS.map(e => [e, 0])) as Record<
      (typeof EMOTIONS)[number],
      number
    >
    let emotionOther = 0
    const model = new Map<string, number>()
    let modelOther = 0

    for (const t of filtered) {
      const o = classifyTrade(t)
      if (o === 'win') win++
      else if (o === 'loss') loss++
      else be++

      if (t.rating === 'good') good++
      else if (t.rating === 'excellent') excellent++
      else if (t.rating === 'poor') poor++

      session[t.session]++

      const b = holdBucketOf(t)
      if (b) hold[b]++
      else holdUnknown++

      if (t.emotion && t.emotion in emotion) emotion[t.emotion]++
      else emotionOther++

      if (t.model_id) model.set(t.model_id, (model.get(t.model_id) ?? 0) + 1)
      else modelOther++
    }

    return {
      outcome: { win, loss, be },
      rating: { good, excellent, poor },
      session,
      hold,
      holdUnknown,
      emotion,
      emotionOther,
      model,
      modelOther,
    }
  }, [filtered])

  const outcomeDonut = useMemo(
    () => [
      { label: 'Wins', value: donutCounts.outcome.win, color: 'var(--color-win)' },
      { label: 'Losses', value: donutCounts.outcome.loss, color: 'var(--color-loss)' },
      { label: 'Breakeven', value: donutCounts.outcome.be, color: 'var(--color-chart-muted)' },
    ],
    [donutCounts],
  )

  const sessionDonut = useMemo(
    () => [
      { label: 'pre', value: donutCounts.session.pre, color: SESSION_BG.pre },
      { label: 'am', value: donutCounts.session.am, color: SESSION_BG.am },
      { label: 'lunch', value: donutCounts.session.lunch, color: SESSION_BG.lunch },
      { label: 'pm', value: donutCounts.session.pm, color: SESSION_BG.pm },
      { label: 'aft', value: donutCounts.session.aft, color: SESSION_BG.aft },
    ],
    [donutCounts],
  )

  const holdDonut = useMemo(() => {
    const segments: Array<{
      label: string
      value: number
      color: string
      legendHidden?: boolean
    }> = HOLD_BUCKETS.map(b => ({
      label: b,
      value: donutCounts.hold[b],
      color: HOLD_PALETTE[b],
    }))
    if (donutCounts.holdUnknown > 0) {
      // Trades with fewer than two parsable execution times don't fit any
      // bucket; show them in the donut for accuracy but skip the legend so
      // the user isn't distracted by an "(unknown)" row that they can't
      // act on.
      segments.push({
        label: '(unknown)',
        value: donutCounts.holdUnknown,
        color: 'var(--color-chart-muted)',
        legendHidden: true,
      })
    }
    return segments
  }, [donutCounts])

  const ratingDonut = useMemo(
    () => [
      {
        label: 'excellent',
        value: donutCounts.rating.excellent,
        color: 'var(--color-win)',
        legendNode: (
          <span className="inline-flex items-center gap-1.5">
            <RatingStars rating="excellent" />
            <span className="text-(--color-text-dim)">(excellent)</span>
          </span>
        ),
      },
      {
        label: 'good',
        value: donutCounts.rating.good,
        color: 'var(--color-accent)',
        legendNode: (
          <span className="inline-flex items-center gap-1.5">
            <RatingStars rating="good" />
            <span className="text-(--color-text-dim)">(good)</span>
          </span>
        ),
      },
      {
        label: 'poor',
        value: donutCounts.rating.poor,
        color: 'var(--color-chart-muted)',
        legendNode: (
          <span className="inline-flex items-center gap-1.5">
            <RatingStars rating="poor" />
            <span className="text-(--color-text-dim)">(poor)</span>
          </span>
        ),
      },
    ],
    [donutCounts],
  )

  const emotionDonut = useMemo(() => {
    const segments: Array<{
      label: string
      value: number
      color: string
      legendHidden?: boolean
    }> = EMOTIONS.map(e => ({
      label: e,
      value: donutCounts.emotion[e],
      color: EMOTION_COLORS[e],
    }))
    if (donutCounts.emotionOther > 0) {
      segments.push({
        label: 'Other',
        value: donutCounts.emotionOther,
        color: 'var(--color-chart-muted)',
        legendHidden: true,
      })
    }
    return segments
  }, [donutCounts])

  const modelDonut = useMemo(() => {
    const nameById = new Map<string, string>()
    for (const p of models ?? []) nameById.set(p.id, p.name)
    // Trades whose model_id no longer exists fall through to the
    // "gambling" wedge along with truly unmodelled trades.
    let unmodelled = donutCounts.modelOther
    const counts = new Map<string, number>()
    for (const [id, n] of donutCounts.model) {
      if (nameById.has(id)) counts.set(id, n)
      else unmodelled += n
    }
    const segments: Array<{
      label: string
      value: number
      color: string
      legendHidden?: boolean
    }> = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, value], i) => ({
        label: nameById.get(id)!,
        value,
        color: MODEL_PALETTE[i % MODEL_PALETTE.length],
      }))
    if (unmodelled > 0) {
      segments.push({
        label: DEFAULT_MODEL_NAME,
        value: unmodelled,
        color: 'var(--color-chart-muted)',
      })
    }
    return segments
  }, [donutCounts, models])

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Distributions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <DonutChart title="Outcomes" segments={outcomeDonut} />
        <DonutChart title="Ratings" segments={ratingDonut} />
        <DonutChart title="Sessions" segments={sessionDonut} />
        <DonutChart title="Models" segments={modelDonut} />
        <DonutChart title="Emotions" segments={emotionDonut} legendColumns={2} />
        <DonutChart title="Durations" segments={holdDonut} legendColumns={2} />
      </div>
    </section>
  )
})

export const CompositeScoreSection = memo(function CompositeScoreSection({
  filtered,
  stats,
  rangeStart,
  rangeEnd,
}: {
  filtered: TradeRecord[]
  stats: AggregateStats
  rangeStart: string | null
  rangeEnd: string | null
}) {
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
})

export const AdvancedMetricsSections = memo(function AdvancedMetricsSections({
  filtered,
  stats,
  rangeStart,
  rangeEnd,
}: {
  filtered: TradeRecord[]
  stats: AggregateStats
  rangeStart: string | null
  rangeEnd: string | null
}) {
  const days = useMemo(() => buildDayRange(rangeStart, rangeEnd), [rangeStart, rangeEnd])
  const equitySeries = useMemo(() => dailyEquitySeries(filtered, days, 0), [filtered, days])
  const ddStats = useMemo(() => drawdownStats(equitySeries, stats.net_pnl), [equitySeries, stats.net_pnl])
  const ratios = useMemo(() => ratioStats(equitySeries, ddStats.maxDdPct), [equitySeries, ddStats.maxDdPct])
  const pf = useMemo(() => profitFactor(filtered), [filtered])
  const expR = useMemo(() => expectancyR(filtered), [filtered])
  const expDollars = useMemo(() => expectancyDollars(filtered), [filtered])
  const sqnVal = useMemo(() => sqn(filtered), [filtered])
  const streaks = useMemo(() => streakStats(filtered), [filtered])
  const maeMfe = useMemo(() => maeMfeStats(filtered), [filtered])
  const extremes = useMemo(() => extremeStats(filtered), [filtered])
  const dayStats = useMemo(() => dailyStats(equitySeries), [equitySeries])
  const totalDays =
    dayStats.greenDays + dayStats.redDays + dayStats.breakevenDays

  return (
    <div className="space-y-8">
      <MetricGroup title="Performance">
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
      </MetricGroup>

      <MetricGroup title="Risk metrics">
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
          label="Ulcer Index"
          value={ddStats.ulcerIndex.toFixed(2)}
          caption={qualUlcer(ddStats.ulcerIndex)}
          tooltip="Pain index. Squared average of percentage drawdowns over the period — higher = deeper or longer underwater stretches. 0 = no drawdowns."
        />
      </MetricGroup>

      <MetricGroup title="Excursion (per trade)">
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
      </MetricGroup>

      <MetricGroup title="Daily">
        <KpiTile
          label="Best day"
          value={dayStats.bestDay === null ? '—' : formatUsd(dayStats.bestDay)}
          tone={dayStats.bestDay === null ? 'dim' : 'win'}
          tooltip="Highest single-day net PnL."
        />
        <KpiTile
          label="Worst day"
          value={dayStats.worstDay === null ? '—' : formatUsd(dayStats.worstDay)}
          tone={dayStats.worstDay === null ? 'dim' : 'loss'}
          tooltip="Lowest single-day net PnL."
        />
        <KpiTile
          label="Avg daily P&L"
          value={dayStats.avgDailyPnl === null ? '—' : formatUsd(dayStats.avgDailyPnl)}
          tone={
            dayStats.avgDailyPnl === null
              ? 'dim'
              : dayStats.avgDailyPnl > 0
                ? 'win'
                : dayStats.avgDailyPnl < 0
                  ? 'loss'
                  : 'dim'
          }
          caption={`across ${totalDays} day${totalDays === 1 ? '' : 's'}`}
          tooltip="Mean PnL across days that had at least one trade."
        />
        <KpiTile
          label="Day win rate"
          value={
            dayStats.dayWinRate === null
              ? '—'
              : `${Math.round(dayStats.dayWinRate * 100)}%`
          }
          caption={`${dayStats.greenDays}G / ${dayStats.redDays}R`}
          tooltip="Share of trading days that closed green. Different from trade win rate — tells you how often a session ended profitable."
        />
      </MetricGroup>

      <MetricGroup title="Extremes & streaks">
        <KpiTile
          label="Largest win"
          value={extremes.largestWin === null ? '—' : formatUsd(extremes.largestWin)}
          tone={extremes.largestWin === null ? 'dim' : 'win'}
          tooltip="Single best winning trade in this period."
        />
        <KpiTile
          label="Largest loss"
          value={extremes.largestLoss === null ? '—' : formatUsd(extremes.largestLoss)}
          tone={extremes.largestLoss === null ? 'dim' : 'loss'}
          tooltip="Single worst losing trade in this period."
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
      </MetricGroup>
    </div>
  )
})

function MetricGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  // Each row gets exactly N columns where N is the number of tiles in this
  // group, so the row fills the full width regardless of how many tiles
  // (4, 5, 6) the group has. Below the lg breakpoint we fall back to a
  // generic 2/3 grid so narrow viewports don't squeeze tiles into unreadable
  // strips. `minmax(0, 1fr)` lets tile content (long labels) ellipsize
  // instead of forcing the column wider than its share.
  const count = Math.max(1, Children.count(children))
  return (
    <div>
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      <div
        className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-1.5 lg:[grid-template-columns:var(--cols)]"
        style={{ ['--cols' as string]: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {children}
      </div>
    </div>
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
        'bg-(--color-panel) shadow-(--shadow-drop-sm) rounded-(--radius) p-3 transition-colors',
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
      <div className="flex-1 flex items-center justify-center bg-(--color-panel) rounded-(--radius) shadow-(--shadow-drop-xs) p-4">
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
                  <circle cx={pt.x} cy={pt.y} r={2} fill="var(--color-panel)" />
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
function qualUlcer(v: number): string {
  if (v < 1) return 'smooth'
  if (v < 3) return 'mild'
  if (v < 6) return 'painful'
  return 'severe'
}
