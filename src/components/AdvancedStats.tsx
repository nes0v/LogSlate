import { Children, memo, useMemo } from 'react'
import { eachDayOfInterval, format, isWeekend, parseISO } from 'date-fns'
import { DonutChart } from '@/components/DonutChart'
import { type AggregateStats } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { classifyTrade, OUTCOME_COLORS, TRADE_OUTCOMES } from '@/lib/trade-math'
import { RATING_COLORS, RATING_DISPLAY_ORDER } from '@/lib/rating'
import { HOLD_BUCKETS, holdBucketOf } from '@/lib/filters'
import { cn } from '@/lib/utils'
import type { Model, Rating, Session, TradeRecord } from '@/db/types'
import { EMOTIONS, RATINGS, SESSIONS, DEFAULT_MODEL_NAME } from '@/db/types'
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
  // Weekdays only — futures don't trade Sat/Sun, so including weekend
  // days in the equity series inflates the "underwater duration" by
  // ~2 days per week (Fri-recovery rolls over Sat+Sun) and dilutes the
  // ulcer-index / UPI denominators with zero-PNL flat points the user
  // could never have traded through.
  return eachDayOfInterval({
    start: parseISO(rangeStart),
    end: parseISO(rangeEnd),
  })
    .filter(d => !isWeekend(d))
    .map(d => format(d, 'yyyy-MM-dd'))
}

export const HeroNetPnl = memo(function HeroNetPnl({
  stats,
}: {
  stats: AggregateStats
}) {
  return (
    <section className="flex flex-col gap-2 h-full">
      <h2 className="text-sm font-medium">Net PNL</h2>
      <div className="flex-1 flex flex-col items-center justify-center text-center py-6 rounded-(--radius) bg-(--color-panel)">
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

const HOLD_PALETTE: Record<(typeof HOLD_BUCKETS)[number], string> = {
  '1m': '#60a5fa',
  '1-5m': '#38bdf8',
  '5-15m': '#22d3ee',
  '15-30m': '#34d399',
  '30-60m': '#facc15',
  '1-2h': '#fb923c',
  '2-4h': '#f97316',
  '4h+': '#ef4444',
}

// Emotions borrow the duration ramp, walked in EMOTIONS order — so the list
// reads cool-to-warm from `calm` through to `lost`. Referenced by bucket
// rather than re-typing the hexes, so the two donuts can never drift apart.
const EMOTION_COLORS: Record<(typeof EMOTIONS)[number], string> = {
  calm: HOLD_PALETTE['1m'],
  focused: HOLD_PALETTE['1-5m'],
  anxious: HOLD_PALETTE['5-15m'],
  impatient: HOLD_PALETTE['15-30m'],
  drained: HOLD_PALETTE['30-60m'],
  greedy: HOLD_PALETTE['1-2h'],
  tilted: HOLD_PALETTE['2-4h'],
  lost: HOLD_PALETTE['4h+'],
}

// Palette for the model donut. Cycled by index when the user has more
// models than colors — at 9 entries that should never realistically wrap.
const MODEL_PALETTE = [
  'var(--color-accent)',
  '#c4b5fd',
  '#7dd3fc',
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#2563eb',
  '#f472b6',
  '#fb923c',
]

export const DistributionDonuts = memo(function DistributionDonuts({
  filtered,
  models,
  includeScratches = true,
}: {
  filtered: TradeRecord[]
  /** When false, scratches are already excluded from `filtered` (global
   *  toggle), so the Outcomes donut drops its scratch slice too. */
  includeScratches?: boolean
  /** Resolved by the parent route so the Models donut paints with the
   *  right names on first frame. Without this, a fresh useLiveQuery here
   *  starts with `[]` for one tick and the donut briefly reads "gambling
   *  100%" before re-rendering with the real data. */
  models: Model[]
}) {
  // One pass over `filtered` populates every donut's counts. Previously
  // each donut had its own useMemo with its own loop — at 6 donuts and N
  // trades that's 6N work plus per-trade `classifyTrade` / `holdBucketOf`
  // calls (which are themselves O(executions) without their own caches).
  // Single-pass keeps everything to N.
  const donutCounts = useMemo(() => {
    const outcome = Object.fromEntries(TRADE_OUTCOMES.map(o => [o, 0])) as Record<
      (typeof TRADE_OUTCOMES)[number],
      number
    >
    const rating = Object.fromEntries(RATINGS.map(r => [r, 0])) as Record<Rating, number>
    const session = Object.fromEntries(SESSIONS.map(s => [s, 0])) as Record<Session, number>
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
      outcome[classifyTrade(t)]++

      if (t.rating) rating[t.rating]++

      session[t.session]++

      const b = holdBucketOf(t)
      if (b) hold[b]++
      else holdUnknown++

      if (t.emotion in emotion) emotion[t.emotion]++
      else emotionOther++

      if (t.model_id) model.set(t.model_id, (model.get(t.model_id) ?? 0) + 1)
      else modelOther++
    }

    return {
      outcome,
      rating,
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
    () =>
      TRADE_OUTCOMES
        // Scratches are hidden globally when the toggle is off — drop the
        // slice rather than show an empty "scratch 0%".
        .filter(o => includeScratches || o !== 'scratch')
        .map(o => ({ label: o, value: donutCounts.outcome[o], color: OUTCOME_COLORS[o] })),
    [donutCounts, includeScratches],
  )

  const sessionDonut = useMemo(
    () =>
      SESSIONS.map(s => ({
        label: s,
        value: donutCounts.session[s],
        color: SESSION_BG[s],
      })),
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
    () =>
      RATING_DISPLAY_ORDER.map(r => ({
        label: r,
        value: donutCounts.rating[r],
        color: RATING_COLORS[r],
      })),
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
    const known = new Set((models ?? []).map(p => p.id))
    // Trades whose model_id no longer exists fall through to the
    // "gambling" wedge along with truly unmodelled trades.
    let unmodelled = donutCounts.modelOther
    for (const [id, n] of donutCounts.model) {
      if (!known.has(id)) unmodelled += n
    }
    // Segments follow the user-set model order from the Models page (the
    // order `models` already arrives in), not trade count.
    const segments: Array<{
      label: string
      value: number
      color: string
      legendHidden?: boolean
    }> = (models ?? [])
      .map((p, i) => ({
        label: p.name,
        value: donutCounts.model.get(p.id) ?? 0,
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
        <DonutChart title="Models" segments={modelDonut} legendColumns={modelDonut.length > 5 ? 2 : 1} />
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
  accountStartEquity,
  adjByDate,
  overridesByDate,
}: {
  filtered: TradeRecord[]
  stats: AggregateStats
  rangeStart: string | null
  rangeEnd: string | null
  /** Real account equity strictly before `rangeStart`. Owned by the
   *  route (Overview) so the card doesn't open its own Dexie
   *  subscriptions — those were causing a post-mount layout jump as
   *  the queries resolved async after the page-level gate had opened. */
  accountStartEquity: number
  /** In-range adjustments map (signed; deposit positive, withdraw
   *  negative). Anchors `peak` so `maxDdPct` is measured against the
   *  user's real capital, not the trade-only cumulative. */
  adjByDate: Map<string, number>
  /** Day-level PNL overrides (date → value). Each replaces its day's trade
   *  PNL in the equity series. Keys outside the window are ignored. */
  overridesByDate?: Map<string, number>
}) {
  const days = useMemo(() => buildDayRange(rangeStart, rangeEnd), [rangeStart, rangeEnd])
  // `rawSeries` walks every weekday in the window — used as the source
  // for `peakEquity` (so a deposit on a non-trade day still anchors the
  // capital baseline) and as the source of truth for any consumer that
  // needs the running equity through gaps.
  const rawSeries = useMemo(
    () => dailyEquitySeries(filtered, days, accountStartEquity, adjByDate, overridesByDate),
    [filtered, days, accountStartEquity, adjByDate, overridesByDate],
  )
  // `tradingSeries` keeps only days where a trade actually happened.
  // All dd, ratio, and streak metrics run off this so weekends,
  // holidays, and untraded weekdays don't count as time underwater
  // and don't dilute the daily-pnl mean/stdev that drive Sharpe etc.
  const tradingSeries = useMemo(
    () => rawSeries.filter(p => p.pnl !== 0),
    [rawSeries],
  )
  const ddStats = useMemo(
    () => drawdownStats(tradingSeries, stats.net_pnl),
    [tradingSeries, stats.net_pnl],
  )
  const pf = useMemo(() => profitFactor(filtered), [filtered])
  const payoff = useMemo(() => payoffRatio(filtered), [filtered])

  // Max peak reached anywhere in the period. Pulled from `rawSeries`
  // (not `tradingSeries`) so a deposit-only Apr 30 still establishes
  // the capital baseline for the compositeScore drawdown component
  // even if the user takes weeks to open their first trade.
  const peakEquity = useMemo(
    () => rawSeries.reduce((m, p) => Math.max(m, p.peak), 0),
    [rawSeries],
  )
  const composite = useMemo(
    () =>
      compositeScore({
        profitFactor: pf,
        payoff,
        winRate: stats.win_rate,
        maxDdPct: ddStats.maxDdPct,
        recoveryFactor: ddStats.recoveryFactor,
        dailyPnls: tradingSeries.map(p => p.pnl),
        netPnl: stats.net_pnl,
        wins: stats.wins,
        losses: stats.losses,
        peakEquity,
      }),
    [
      pf,
      payoff,
      stats.win_rate,
      ddStats.maxDdPct,
      ddStats.recoveryFactor,
      tradingSeries,
      stats.net_pnl,
      stats.wins,
      stats.losses,
      peakEquity,
    ],
  )

  return <CompositeScoreCard score={composite} />
})

export const AdvancedMetricsSections = memo(function AdvancedMetricsSections({
  filtered,
  stats,
  rangeStart,
  rangeEnd,
  accountStartEquity,
  adjByDate,
  overridesByDate,
}: {
  filtered: TradeRecord[]
  stats: AggregateStats
  rangeStart: string | null
  rangeEnd: string | null
  /** Real account equity strictly before `rangeStart`. Owned by the
   *  route (Reports) so the card doesn't open its own Dexie
   *  subscriptions — those resolved a tick after the page-level gate
   *  and caused a post-mount layout jump. */
  accountStartEquity: number
  /** In-range adjustments map (signed; deposit positive, withdraw
   *  negative). Anchors `peak` for the equity series and tracks real
   *  capital across the period for `dailyStats`'s scratch band. */
  adjByDate: Map<string, number>
  /** Day-level PNL overrides (date → value). Each replaces its day's trade
   *  PNL in the equity series. Keys outside the window are ignored. */
  overridesByDate?: Map<string, number>
}) {
  const days = useMemo(() => buildDayRange(rangeStart, rangeEnd), [rangeStart, rangeEnd])
  // `rawSeries` keeps every weekday so `dailyStats` can pick up
  // adjustments that landed on non-trade days when computing the
  // scratch-band running equity. `tradingSeries` is the filtered view
  // used by dd / ratio / streak metrics — see CompositeScoreSection
  // for the broader rationale.
  const rawSeries = useMemo(
    () => dailyEquitySeries(filtered, days, accountStartEquity, adjByDate, overridesByDate),
    [filtered, days, accountStartEquity, adjByDate, overridesByDate],
  )
  const tradingSeries = useMemo(
    () => rawSeries.filter(p => p.pnl !== 0),
    [rawSeries],
  )
  const ddStats = useMemo(
    () => drawdownStats(tradingSeries, stats.net_pnl),
    [tradingSeries, stats.net_pnl],
  )
  const ratios = useMemo(() => ratioStats(tradingSeries), [tradingSeries])
  const pf = useMemo(() => profitFactor(filtered), [filtered])
  const expR = useMemo(() => expectancyR(filtered), [filtered])
  const expDollars = useMemo(() => expectancyDollars(filtered), [filtered])
  const sqnVal = useMemo(() => sqn(filtered), [filtered])
  // Override days within the window — passed to streakStats so a tilt day
  // breaks the win/loss run. Scoped to [rangeStart, rangeEnd] so an override
  // outside the filter can't reset a streak it isn't part of.
  const windowOverrides = useMemo(() => {
    if (!overridesByDate || overridesByDate.size === 0) return undefined
    const m = new Map<string, number>()
    for (const [d, v] of overridesByDate) {
      if ((rangeStart == null || d >= rangeStart) && (rangeEnd == null || d <= rangeEnd)) {
        m.set(d, v)
      }
    }
    return m
  }, [overridesByDate, rangeStart, rangeEnd])
  const streaks = useMemo(() => streakStats(filtered, windowOverrides), [filtered, windowOverrides])
  const maeMfe = useMemo(() => maeMfeStats(filtered), [filtered])
  const extremes = useMemo(() => extremeStats(filtered), [filtered])
  const dayStats = useMemo(
    () => dailyStats(rawSeries, accountStartEquity, adjByDate),
    [rawSeries, accountStartEquity, adjByDate],
  )
  const totalDays =
    dayStats.greenDays + dayStats.redDays + dayStats.scratchDays

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
          tooltip="Total profit from winners divided by total loss from losers. Above 1 means you make more than you lose; 2 = you earn $2 for every $1 lost."
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

      <MetricGroup title="Excursion">
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

      <MetricGroup title="Days">
        <KpiTile
          label="Best day"
          value={dayStats.bestDay === null ? '—' : formatUsd(dayStats.bestDay)}
          tone={dayStats.bestDay === null ? 'dim' : 'win'}
          tooltip="Highest single-day net PNL."
        />
        <KpiTile
          label="Worst day"
          value={dayStats.worstDay === null ? '—' : formatUsd(dayStats.worstDay)}
          tone={dayStats.worstDay === null ? 'dim' : 'loss'}
          tooltip="Lowest single-day net PNL."
        />
        <KpiTile
          label="Avg daily PNL"
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
          tooltip="Mean PNL across days that had at least one trade."
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

      <MetricGroup title="Risk">
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
          label="K-Ratio"
          value={ratios.kRatio === null ? '—' : ratios.kRatio.toFixed(2)}
          caption={qualKRatio(ratios.kRatio)}
          tooltip="Slope of your equity curve divided by its own noise. Higher = more linear, fewer wild swings. Above 1 = smooth, above 2 = unusually consistent."
        />
        <KpiTile
          label="Tail Ratio"
          value={ratios.tailRatio === null ? '—' : ratios.tailRatio.toFixed(2)}
          caption={qualTailRatio(ratios.tailRatio)}
          tooltip="Average of your top 5% days divided by the magnitude of the bottom 5%. Above 1 means your best days dwarf your worst; below 1 means losses bite harder than wins reward."
        />
        <KpiTile
          label="Recovery"
          value={ddStats.recoveryFactor === null ? '—' : ddStats.recoveryFactor.toFixed(2)}
          caption={qualRecovery(ddStats.recoveryFactor)}
          tooltip="Net PNL divided by your worst drawdown. 3 = you've earned 3× your worst drawdown back."
        />
        <KpiTile
          label="Ulcer Index"
          value={ddStats.ulcerIndex.toFixed(2)}
          caption={qualUlcer(ddStats.ulcerIndex)}
          tooltip="Pain index. Squared average of percentage drawdowns over the period — higher = deeper or longer underwater stretches. 0 = no drawdowns."
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
          tooltip="Largest peak-to-trough drop in your equity curve over this period. Caption is the longest contiguous stretch of traded days the account spent below its prior high — historical, not your present state."
        />
        <KpiTile
          label="Current DD"
          value={ddStats.currentDd === 0 ? '—' : formatUsd(ddStats.currentDd)}
          caption={
            ddStats.currentDdDurationDays === 0
              ? 'at peak'
              : `${ddStats.currentDdDurationDays}d underwater`
          }
          tone={ddStats.currentDd === 0 ? 'dim' : 'loss'}
          tooltip="Drop from the most recent equity peak as of the latest traded day. Zero means equity is at or above the highest level seen in this filter window. The caption shows the consecutive traded days the account has been below that peak."
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
          label={'Current\nstreak'}
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
        className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-2 lg:[grid-template-columns:var(--cols)]"
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
        'flex flex-col bg-(--color-panel-2) rounded-(--radius) p-3',
        tooltip && 'cursor-help',
      )}
      title={tooltip}
    >
      <div className="text-xs uppercase tracking-[0.08em] font-medium text-(--color-text-dim) whitespace-pre-line">
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
        <div className="text-xs text-(--color-text-dim) mt-auto pt-1">{caption}</div>
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
  const total = score.total
  const totalDisplay = Math.round(total).toString()
  // Composite score is always shown in the accent (purple) — the score value
  // conveys quality on its own; the color shouldn't also swing win/loss.
  const fillColor = 'var(--color-accent)'

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
  // Skip null vertices (currently only `consistency` when the window is
  // <2 days). The resulting polygon has 5 vertices instead of 6 — the
  // edge bridges directly across the missing axis so the user sees a
  // visibly different shape rather than the polygon collapsing inward.
  const valuePath =
    parts
      .map((p, i) => ({ value: score.parts[p.key], i }))
      .filter((v): v is { value: number; i: number } => v.value !== null)
      .map((v, idx) => {
        const pct = Math.max(0, Math.min(100, v.value)) / 100
        const pt = point(angles[v.i], R * pct)
        return `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
      })
      .join(' ') + ' Z'

  return (
    <section className="flex flex-col gap-2 h-full">
      <h2 className="text-sm font-medium">Composite score</h2>
      <div className="flex-1 flex items-center justify-center bg-(--color-panel) rounded-(--radius) p-4">
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
                stroke="var(--color-panel-3)"
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
                  stroke="var(--color-panel-3)"
                  strokeWidth={1}
                  strokeOpacity={0.35}
                />
              )
            })}
            <path d={valuePath} fill={fillColor} fillOpacity={0.22} />
            {parts.map((p, i) => {
              const raw = score.parts[p.key]
              // Null sub-score: render a hollow dot at the outer ring so
              // the axis has a marker without suggesting a specific value.
              if (raw === null) {
                const pt = point(angles[i], R)
                return (
                  <g key={p.key}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={5}
                      fill="none"
                      stroke="var(--color-text-faint)"
                      strokeWidth={1.5}
                    />
                  </g>
                )
              }
              const pct = Math.max(0, Math.min(100, raw)) / 100
              const pt = point(angles[i], R * pct)
              return (
                <g key={p.key}>
                  <circle cx={pt.x} cy={pt.y} r={5} fill={fillColor} />
                  <circle cx={pt.x} cy={pt.y} r={2} fill="var(--color-panel)" />
                </g>
              )
            })}
            {parts.map((p, i) => {
              const raw = score.parts[p.key]
              const v = raw === null ? 'n/a' : String(Math.round(raw))
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
                    fill={raw === null ? 'var(--color-text-faint)' : 'var(--color-text-dim)'}
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
              className="text-5xl font-mono font-medium tabular-nums leading-none text-(--color-text)"
            >
              {totalDisplay}
            </div>
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
function qualKRatio(v: number | null): string | undefined {
  if (v === null) return undefined
  if (v < 0) return 'losing'
  if (v < 0.5) return 'choppy'
  if (v < 1) return 'ok'
  if (v < 2) return 'smooth'
  return 'exceptional'
}
function qualTailRatio(v: number | null): string | undefined {
  if (v === null) return undefined
  if (v < 0.75) return 'losers bigger'
  if (v < 1) return 'slight edge to losers'
  if (v < 1.25) return 'balanced'
  if (v < 1.75) return 'winners bigger'
  return 'winners dwarf losers'
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
