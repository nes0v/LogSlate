import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import type { TradeRecord } from '@/db/types'
import { EMOTIONS, DEFAULT_MODEL_NAME } from '@/db/types'
import { listAdjustments, listAllTrades, listModels } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import {
  applyFilters,
  FILTER_PARAM_KEYS,
  filtersFromParams,
  hasAttributeFilter,
  paramsFromFilters,
  type TradeFilters,
} from '@/lib/filters'
import {
  hasAnyFilter,
  loadSharedFilters,
  saveSharedFilters,
} from '@/lib/shared-filters'
import { useDefaultRangeFilters } from '@/lib/use-default-range-filters'
import { aggregate, signedAdjustment, type AggregateStats } from '@/lib/trade-stats'
import { netPnlByDate, sumNetPnl } from '@/lib/day-pnl'
import {
  classifyTrade,
  computePlannedRr,
  computeRealizedRr,
  totalContracts,
  tradeMetrics,
  type TradeOutcome,
} from '@/lib/trade-math'
import {
  cohortStats,
  maeScatter,
  mfeScatter,
  pnlByHour,
  pnlByMonth,
  pnlByWeek,
  pnlByWeekday,
  rDistribution,
  type ScatterPoint,
} from '@/lib/advanced-stats'
import { formatUsd } from '@/lib/money'
import { StatsFilterBar } from '@/components/StatsFilterBar'
import { AdvancedMetricsSections } from '@/components/AdvancedStats'
import { BTN_ACCENT } from '@/components/form/buttonClass'
import { Switch } from '@/components/form/Switch'
import { loadJsonFromStorage, saveJsonToStorage } from '@/lib/storage'
import { cn } from '@/lib/utils'

// Persisted toggle: fold day-level PNL overrides into the date-grouped
// breakdowns (day-of-week / day-of-month / weekly / monthly). Off by default
// so those views show real, deliberate trades only; flip on to include the
// combined-PNL "override" days. (When no attribute filter is active, the equity
// chart, Net PNL, drawdown and consistency stats also include overrides.)
const INCLUDE_OVERRIDES_KEY = 'logslate:reports_time_include_overrides'
const readIncludeOverrides = () =>
  loadJsonFromStorage(INCLUDE_OVERRIDES_KEY, v => (typeof v === 'boolean' ? v : null), false)

type ReportTab = 'general' | 'time' | 'symbol' | 'risk' | 'compare'
const TABS: Array<{ value: ReportTab; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'symbol', label: 'Symbol' },
  { value: 'time', label: 'Time' },
  { value: 'risk', label: 'Risk' },
  { value: 'compare', label: 'Compare' },
]

type CompareAxis = 'symbol' | 'contract' | 'session' | 'rating' | 'side' | 'emotion' | 'model'

const TAB_VALUES = TABS.map(t => t.value) as readonly ReportTab[]
const COMPARE_VALUES: readonly CompareAxis[] = [
  'symbol', 'contract', 'session', 'rating', 'side', 'emotion', 'model',
]

export function ReportsRoute() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Read the shared slot synchronously on render when the URL has no
  // filter params — otherwise the first paint uses the default one-month
  // window and only snaps to the real filter once the hydration effect
  // mirrors slot → URL, which surfaces as a content "jump" on nav-link
  // clicks.
  const urlFilters = useMemo<TradeFilters>(() => {
    if (FILTER_PARAM_KEYS.some(k => params.has(k))) {
      return filtersFromParams(params)
    }
    const stored = loadSharedFilters()
    if (stored && hasAnyFilter(stored)) return stored
    return filtersFromParams(params)
  }, [params])
  // Tab + compare-axis live in the URL so the browser's back button
  // restores them after a trade-page round-trip — but they're treated
  // separately from filters so they don't arm the "Clear filters"
  // button. `replace: true` on the setters keeps history clean.
  const tab = useMemo<ReportTab>(() => {
    const raw = params.get('tab')
    return TAB_VALUES.includes(raw as ReportTab) ? (raw as ReportTab) : 'general'
  }, [params])
  const compareAxis = useMemo<CompareAxis>(() => {
    const raw = params.get('compare')
    return COMPARE_VALUES.includes(raw as CompareAxis) ? (raw as CompareAxis) : 'symbol'
  }, [params])
  const setTab = useCallback(
    (next: ReportTab) => {
      const p = new URLSearchParams(params)
      if (next === 'general') p.delete('tab')
      else p.set('tab', next)
      setParams(p, { replace: true })
    },
    [params, setParams],
  )
  const setCompareAxis = useCallback(
    (next: CompareAxis) => {
      const p = new URLSearchParams(params)
      if (next === 'symbol') p.delete('compare')
      else p.set('compare', next)
      setParams(p, { replace: true })
    },
    [params, setParams],
  )

  // Keep URL filters and the shared slot in sync on every navigation —
  // mirror URL filter params into the slot, and on a bare URL hydrate
  // from the slot (preserving any non-filter params like `tab`/`compare`).
  // This makes filters survive nav-link clicks back to this page
  // instead of being cleared by the resulting bare URL.
  useEffect(() => {
    const hasFilterParam = FILTER_PARAM_KEYS.some(k => params.has(k))
    if (!hasFilterParam) {
      const stored = loadSharedFilters()
      if (stored && hasAnyFilter(stored)) {
        const next = new URLSearchParams(params)
        paramsFromFilters(stored).forEach((v, k) => next.set(k, v))
        setParams(next, { replace: true })
      }
      return
    }
    const f = filtersFromParams(params)
    saveSharedFilters(hasAnyFilter(f) ? f : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const accountId = useActiveAccountId()
  // No default value — `allTrades` stays undefined while Dexie resolves so
  // we can suppress the empty-state placeholder until the real data lands
  // (otherwise "No trades yet" flashes for one frame on navigation).
  const allTrades = useLiveQuery(() => listAllTrades(accountId), [accountId])
  const allAdjustments = useLiveQuery(
    () => listAdjustments(accountId),
    [accountId],
    [],
  )
  // Day-level overrides + the default filter window (shared with Overview).
  // Reports has no models query, so its full `loaded` gate is just the hook's
  // `rangeReady` (trades + overrides). The explicit `allTrades` check is
  // redundant with `rangeReady` but lets TS narrow it in branches.
  const { overridesByDate, feesOverridesByDate, rangeReady, defaultWindow, filters } =
    useDefaultRangeFilters(accountId, allTrades, urlFilters)
  const loaded = allTrades !== undefined && rangeReady

  const filtered = useMemo(
    () => applyFilters(allTrades ?? [], filters),
    [allTrades, filters],
  )
  const baseStats = useMemo(() => aggregate(filtered), [filtered])
  const effectiveOverrides = useMemo(
    () => hasAttributeFilter(filters) ? new Map<string, number>() : overridesByDate,
    [filters, overridesByDate],
  )
  const effectiveFeesOverrides = useMemo(
    () => hasAttributeFilter(filters) ? new Map<string, number>() : feesOverridesByDate,
    [filters, feesOverridesByDate],
  )
  const stats = useMemo<AggregateStats>(() => {
    const from = filters.from
    const to = filters.to
    const inWindow = (d: string) => (from == null || d >= from) && (to == null || d <= to)
    const net = sumNetPnl(netPnlByDate(filtered, effectiveOverrides), inWindow)
    const fees = baseStats.fees + sumNetPnl(effectiveFeesOverrides, inWindow)
    return { ...baseStats, net_pnl: net, fees }
  }, [baseStats, filtered, effectiveOverrides, effectiveFeesOverrides, filters.from, filters.to])
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (filters.from && filters.to) return { rangeStart: filters.from, rangeEnd: filters.to }
    if (filtered.length === 0) return { rangeStart: null, rangeEnd: null }
    const dates = filtered.map(t => t.date).sort()
    return {
      rangeStart: filters.from ?? dates[0],
      rangeEnd: filters.to ?? dates[dates.length - 1],
    }
  }, [filtered, filters.from, filters.to])

  // Inputs the Risk-metrics card needs. Computed locally from already-
  // loaded `allTrades` + `allAdjustments` so the card doesn't open its
  // own Dexie subscriptions — those resolved async after the page-level
  // `loaded` gate and caused a post-mount layout jump. Same fix the
  // Overview page got for `CompositeScoreSection`.
  const advStartingEquity = useMemo(() => {
    if (!rangeStart) return 0
    let eq = 0
    for (const a of allAdjustments ?? []) {
      if (a.date < rangeStart) eq += signedAdjustment(a)
    }
    // Day-net before the range, with override days replacing their trades.
    eq += sumNetPnl(
      netPnlByDate(allTrades ?? [], overridesByDate),
      d => d < rangeStart,
    )
    return eq
  }, [allTrades, allAdjustments, overridesByDate, rangeStart])
  const advAdjByDate = useMemo(() => {
    const m = new Map<string, number>()
    if (!rangeStart || !rangeEnd) return m
    for (const a of allAdjustments ?? []) {
      if (a.date >= rangeStart && a.date <= rangeEnd) {
        m.set(a.date, (m.get(a.date) ?? 0) + signedAdjustment(a))
      }
    }
    return m
  }, [allAdjustments, rangeStart, rangeEnd])

  // Day overrides inside the active window. Date-grouped breakdowns (Time)
  // fold these in only when the "Include override days" toggle is on. Scoped
  // to [rangeStart, rangeEnd] so an override outside the filter can't leak
  // into a bucket it isn't part of.
  const windowOverrides = useMemo(() => {
    const m = new Map<string, number>()
    for (const [d, v] of effectiveOverrides) {
      if ((rangeStart == null || d >= rangeStart) && (rangeEnd == null || d <= rangeEnd)) {
        m.set(d, v)
      }
    }
    return m
  }, [effectiveOverrides, rangeStart, rangeEnd])

  // Hoist current tab/compare URL values once per render so the
  // update/clear closures don't re-read `params` (the React Compiler
  // can't preserve downstream `useMemo`s when those reads happen
  // inside non-memoized callbacks).
  const currentTabParam = params.get('tab')
  const currentCompareParam = params.get('compare')
  function update(next: Partial<TradeFilters>) {
    const merged: TradeFilters = { ...urlFilters, ...next }
    if (merged.from === defaultWindow.from) merged.from = null
    if (merged.to === defaultWindow.to) merged.to = null
    saveSharedFilters(hasAnyFilter(merged) ? merged : null)
    const p = paramsFromFilters(merged)
    // Preserve non-filter UI params (tab, compare) across filter edits.
    if (currentTabParam) p.set('tab', currentTabParam)
    if (currentCompareParam) p.set('compare', currentCompareParam)
    setParams(p)
  }
  function clear() {
    saveSharedFilters(null)
    const p = new URLSearchParams()
    if (currentTabParam) p.set('tab', currentTabParam)
    if (currentCompareParam) p.set('compare', currentCompareParam)
    setParams(p)
  }

  // "Default" = no active filter; tab/compare aren't filters.
  const isDefault = !hasAnyFilter(urlFilters)

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Reports</h1>
        {!isDefault && (
          <button onClick={clear} className={BTN_ACCENT}>
            <X className="size-4" /> Clear filters
          </button>
        )}
      </div>

      {/* Always present (no layout jump). Date values stay "Any" until
          `loaded`, so the bar never flashes a today-based default. */}
      <StatsFilterBar filters={filters} update={update} />

      {!loaded ? null : filtered.length === 0 ? (
        <EmptyState>
          {allTrades.length === 0
            ? 'No trades yet.'
            : 'No trades match the current filters.'}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[12rem_1fr] gap-3">
          <nav
            aria-label="Report sections"
            className="bg-(--color-panel) rounded-(--radius) p-3 space-y-1.5"
          >
            {TABS.map(t => {
              const active = t.value === tab
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTab(t.value)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'block w-full text-left p-3 rounded-sm text-sm transition-colors duration-300 ease-out',
                    active
                      ? 'bg-(--color-panel-3) text-(--color-text)'
                      : 'bg-(--color-panel-2) text-(--color-text-dim) hover:bg-(--color-panel-3) hover:text-(--color-text)',
                  )}
                >
                  {t.label}
                </button>
              )
            })}
          </nav>

          <div className="min-w-0">
            {tab === 'general' ? (
              <div className="bg-(--color-panel) rounded-(--radius) p-3 h-full">
                <AdvancedMetricsSections
                  filtered={filtered}
                  stats={stats}
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  accountStartEquity={advStartingEquity}
                  adjByDate={advAdjByDate}
                  overridesByDate={effectiveOverrides}
                />
              </div>
            ) : tab === 'time' ? (
              <div className="bg-(--color-panel) rounded-(--radius) p-3 h-full">
                <DaysAndTimeReport trades={filtered} overridesByDate={windowOverrides} />
              </div>
            ) : tab === 'symbol' ? (
              <div className="bg-(--color-panel) rounded-(--radius) p-3 h-full">
                <SymbolReport trades={filtered} />
              </div>
            ) : tab === 'risk' ? (
              <div className="bg-(--color-panel) rounded-(--radius) p-3 h-full">
                <RiskReport
                  trades={filtered}
                  onTradeClick={id =>
                    navigate(`/trade/${id}/edit`, {
                      state: { from: location.pathname + location.search },
                    })
                  }
                />
              </div>
            ) : (
              <div className="bg-(--color-panel) rounded-(--radius) p-3 h-full">
                <CompareReport trades={filtered} axis={compareAxis} onAxisChange={setCompareAxis} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
      {children}
    </div>
  )
}

// =====================================================================
// Tab: Days & Time
// =====================================================================

function DaysAndTimeReport({
  trades,
  overridesByDate,
}: {
  trades: TradeRecord[]
  overridesByDate?: Map<string, number>
}) {
  const [includeOverrides, setIncludeOverrides] = useState(readIncludeOverrides)
  const hasOverrides = !!overridesByDate && overridesByDate.size > 0
  // Only the date-grouped breakdowns honour the toggle. When off (default) they
  // see real trades only; when on, override days fold into their date bucket.
  const dateOverrides = includeOverrides ? overridesByDate : undefined

  const weekday = useMemo(() => pnlByWeekday(trades, dateOverrides), [trades, dateOverrides])
  const hourFirst = useMemo(() => pnlByHour(trades, 'first'), [trades])
  const hourLast = useMemo(() => pnlByHour(trades, 'last'), [trades])
  const week = useMemo(() => pnlByWeek(trades, dateOverrides), [trades, dateOverrides])
  const month = useMemo(() => pnlByMonth(trades, dateOverrides), [trades, dateOverrides])

  const dayOfMonth = useMemo(() => {
    const map = Array.from({ length: 31 }, (_, i) => ({
      day: i + 1,
      pnl: 0,
      count: 0,
      wins: 0,
      losses: 0,
    }))
    // Counts/wins/losses from real trades only.
    for (const t of trades) {
      const d = Number(t.date.slice(8, 10))
      if (d < 1 || d > 31) continue
      const cell = map[d - 1]
      const { outcome } = tradeMetrics(t)
      cell.count++
      if (outcome === 'win') cell.wins++
      else if (outcome === 'loss') cell.losses++
    }
    // PNL from the override-replaced per-day net so an override day lands on
    // its day-of-month (consistent with the weekday / weekly / monthly views).
    for (const [date, net] of netPnlByDate(trades, dateOverrides)) {
      const d = Number(date.slice(8, 10))
      if (d < 1 || d > 31) continue
      map[d - 1].pnl += net
    }
    return map
  }, [trades, dateOverrides])

  const hourRowsFirst = hourFirst
    .filter(h => h.count > 0)
    .map(h => ({
      label: `${String(h.hour).padStart(2, '0')}:00`,
      count: h.count,
      wins: h.wins,
      losses: h.losses,
      pnl: h.pnl,
    }))
  const hourRowsLast = hourLast
    .filter(h => h.count > 0)
    .map(h => ({
      label: `${String(h.hour).padStart(2, '0')}:00`,
      count: h.count,
      wins: h.wins,
      losses: h.losses,
      pnl: h.pnl,
    }))

  return (
    <div className="space-y-8">
      <SectionGrid>
        <Card title="PNL by hour" caption="bucketed by first execution">
          <ReportTable rows={hourRowsFirst} />
        </Card>
        <Card title="PNL by hour" caption="bucketed by last execution">
          <ReportTable rows={hourRowsLast} />
        </Card>
      </SectionGrid>

      {hasOverrides && (
        <Switch
          checked={includeOverrides}
          onChange={next => {
            setIncludeOverrides(next)
            saveJsonToStorage(INCLUDE_OVERRIDES_KEY, next)
          }}
          label="Include override days"
        />
      )}

      <SectionGrid>
        <Card title="Day of week">
          <ReportTable
            rows={weekday
              // Keep buckets with no trades but a non-zero PNL — an override
              // day (count 0) lands here when "Include override days" is on.
              .filter(w => w.count > 0 || w.pnl !== 0)
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
              // Keep buckets with no trades but a non-zero PNL — an override
              // day (count 0) lands here when "Include override days" is on.
              .filter(d => d.count > 0 || d.pnl !== 0)
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
        <Card title="Weekly returns">
          <ReportTable
            rows={week.map(w => ({
              label: w.weekStart,
              count: w.count,
              wins: w.wins,
              losses: w.losses,
              pnl: w.pnl,
            }))}
          />
        </Card>
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
      </SectionGrid>
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
    <div className="space-y-8">
      {groups.map(([key, list]) => {
        const stats = aggregate(list)
        const cohort = cohortStats(list)
        return (
          <div key={key}>
            <h3 className="text-sm font-medium mb-2">
              {key}{' '}
              <span className="text-(--color-text-dim) font-normal">
                ({stats.count})
              </span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-y-3 gap-x-2">
              <Stat
                label="Net PNL"
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
          </div>
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

  // Planned R vs realised R: how often did the actual exit hit the
  // planned R-target? Diagonal y=x = perfect execution; below = cut
  // early / stopped, above = let it run past target.
  const plannedVsRealized = useMemo(() => {
    const out: Array<{ id: string; planned: number; realized: number; outcome: TradeOutcome; date: string }> = []
    for (const t of trades) {
      const planned = computePlannedRr(t)
      const realized = computeRealizedRr(t)
      if (planned === null || realized === null) continue
      out.push({ id: t.id, planned, realized, outcome: classifyTrade(t), date: t.date })
    }
    return out
  }, [trades])

  // Position size (by contract count) breakdown.
  const sizeRows = useMemo(() => {
    const map = new Map<number, { count: number; wins: number; losses: number; pnl: number }>()
    for (const t of trades) {
      const c = totalContracts(t)
      if (c === 0) continue
      const cur = map.get(c) ?? { count: 0, wins: 0, losses: 0, pnl: 0 }
      const { pnl, outcome } = tradeMetrics(t)
      cur.count++
      if (outcome === 'win') cur.wins++
      else if (outcome === 'loss') cur.losses++
      cur.pnl += pnl ?? 0
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
      const { pnl, outcome } = tradeMetrics(t)
      cur.count++
      if (outcome === 'win') cur.wins++
      else if (outcome === 'loss') cur.losses++
      cur.pnl += pnl ?? 0
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
    <div className="space-y-8">
      <SectionGrid>
        <Card
          title="PNL vs MFE"
          caption="how much each trade gave back from peak"
        >
          <Scatter
            points={mfePoints}
            onClick={onTradeClick ? p => onTradeClick(p.id) : undefined}
          />
        </Card>
        <Card
          title="PNL vs MAE"
          caption="how much heat each trade took"
        >
          <Scatter
            points={maePoints}
            onClick={onTradeClick ? p => onTradeClick(p.id) : undefined}
          />
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card title="R-multiple distribution">
          <RDistRows buckets={rDist} />
        </Card>
        <Card title="Planned R" caption="how often does each R target fire?">
          <PlannedRRTable rows={plannedRows} />
        </Card>
      </SectionGrid>

      <SectionGrid>
        <Card
          title="Planned vs realised R"
          caption="below = cut short, above = let run"
        >
          <PlannedRealizedScatter
            points={plannedVsRealized}
            onClick={onTradeClick ? p => onTradeClick(p.id) : undefined}
          />
        </Card>
        <Card title="Position size" caption="contracts per trade">
          <ReportTable rows={sizeRows} />
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
  { value: 'emotion', label: 'Emotion' },
  { value: 'model', label: 'Model' },
  { value: 'side', label: 'Side' },
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
  const accountId = useActiveAccountId()
  // Only fetch model names when actually needed for the rendered axis;
  // useLiveQuery still subscribes either way, but the cost is negligible.
  const models = useLiveQuery(
    () => listModels(accountId),
    [accountId],
    [],
  )
  const modelNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of models ?? []) m.set(p.id, p.name)
    return m
  }, [models])
  const groups = useMemo(
    () => splitByAxis(trades, axis, modelNameById),
    [trades, axis, modelNameById],
  )
  return (
    <section className="h-full flex flex-col">
      {/* Browser-tab style: tabs sit above the section with their bottom
          flush against its top edge, each rounded only at the top. The
          section's top-left is square so the leftmost tab supplies that
          corner. Active tab takes panel-bg, merging seamlessly into the
          body below; inactive tabs use the same hover treatment as the
          report tabs above. */}
      <div role="tablist" className="flex items-center gap-1 text-sm overflow-x-auto">
        {COMPARE_AXES.map(opt => {
          const active = opt.value === axis
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onAxisChange(opt.value)}
              className={cn(
                'px-2.5 py-1.5 rounded-t-(--radius) transition-colors whitespace-nowrap',
                active
                  ? 'text-(--color-text) bg-(--color-panel-2)'
                  : 'text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)/60',
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <div className="bg-(--color-panel-2) rounded-(--radius) rounded-tl-none p-3 space-y-3 flex-1">
        {groups.length === 0 ? (
          <EmptyState>Nothing to compare on this axis.</EmptyState>
        ) : (
          <CompareTable groups={groups} />
        )}
      </div>
    </section>
  )
}

function splitByAxis(
  trades: TradeRecord[],
  axis: CompareAxis,
  modelNameById: Map<string, string>,
): Array<{ label: string; trades: TradeRecord[] }> {
  switch (axis) {
    case 'symbol':
      return [
        { label: 'NQ', trades: trades.filter(t => t.symbol === 'NQ') },
        { label: 'ES', trades: trades.filter(t => t.symbol === 'ES') },
        { label: 'YM', trades: trades.filter(t => t.symbol === 'YM') },
      ].filter(g => g.trades.length > 0)
    case 'contract':
      return [
        { label: 'micro', trades: trades.filter(t => t.contract_type === 'micro') },
        { label: 'mini', trades: trades.filter(t => t.contract_type === 'mini') },
      ].filter(g => g.trades.length > 0)
    case 'session':
      return (['pre', 'am', 'lunch', 'pm', 'aft'] as const)
        .map(s => ({ label: s, trades: trades.filter(t => t.session === s) }))
        .filter(g => g.trades.length > 0)
    case 'rating':
      return [
        { label: 'excellent', trades: trades.filter(t => t.rating === 'excellent') },
        { label: 'good', trades: trades.filter(t => t.rating === 'good') },
        { label: 'poor', trades: trades.filter(t => t.rating === 'poor') },
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
    case 'emotion': {
      // Preserve EMOTIONS' declared order so the buckets always sort the
      // same way.
      return EMOTIONS
        .map(e => ({ label: e, trades: trades.filter(t => t.emotion === e) }))
        .filter(g => g.trades.length > 0)
    }
    case 'model': {
      const map = new Map<string, TradeRecord[]>()
      const unset: TradeRecord[] = []
      for (const t of trades) {
        if (!t.model_id) { unset.push(t); continue }
        if (!map.has(t.model_id)) map.set(t.model_id, [])
        map.get(t.model_id)!.push(t)
      }
      const buckets = Array.from(map.entries())
        .map(([id, v]) => ({
          label: modelNameById.get(id) ?? '(deleted)',
          trades: v,
        }))
        .sort((a, b) => b.trades.length - a.trades.length)
      if (unset.length > 0) buckets.push({ label: DEFAULT_MODEL_NAME, trades: unset })
      return buckets
    }
  }
}

function CompareTable({ groups }: { groups: Array<{ label: string; trades: TradeRecord[] }> }) {
  return (
    <div className="text-xs">
      <div className="grid grid-cols-[100px_repeat(6,1fr)] gap-2 py-1 mb-2 border-b border-(--color-panel-3) text-(--color-text-dim)">
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
        // PF uses the classifyTrade-aware buckets so scratches don't pollute
        // the gross-wins / gross-losses sums.
        let wins = 0
        let losses = 0
        for (const t of g.trades) {
          const { pnl, outcome } = tradeMetrics(t)
          const p = pnl ?? 0
          if (outcome === 'win') wins += p
          else if (outcome === 'loss') losses += p
        }
        const pf = losses === 0 ? (wins > 0 ? Infinity : null) : wins / Math.abs(losses)
        return (
          <div
            key={g.label}
            className="grid grid-cols-[100px_repeat(6,1fr)] gap-2 py-1 font-mono tabular-nums"
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
    <div className="flex flex-col h-full">
      {/* Title row uses h3's natural height (no Pills inflation) so
          side-by-side Cards share an identical title-row height even
          when only one of them has a `right` slot. The right slot is
          absolute-positioned with its bottom flush against the panel's
          top edge, so it visually sits on top of the section. */}
      <div className="relative mb-2">
        <h3 className="text-sm font-medium">
          {title}
          {caption ? (
            <span className="text-(--color-text-dim) font-normal"> ({caption})</span>
          ) : null}
        </h3>
        {right ? (
          <div className="absolute right-0 -bottom-2">{right}</div>
        ) : null}
      </div>
      <div
        className={cn(
          'flex-1 bg-(--color-panel-2) rounded-(--radius) p-3',
          right && 'rounded-tr-none',
        )}
      >
        {children}
      </div>
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
    <div className="bg-(--color-panel-2) rounded-(--radius) p-3">
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

interface ReportRow {
  label: string
  count: number
  wins: number
  losses: number
  pnl: number
  hideWl?: boolean
}
function ReportTable({ rows }: { rows: ReportRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) text-center py-3">
        No data.
      </div>
    )
  }
  const max = Math.max(0, ...rows.map(r => Math.abs(r.pnl)))
  return (
    <div className="text-xs">
        <div className="grid grid-cols-[80px_60px_80px_1fr_80px] gap-2 py-1 mb-2 border-b border-(--color-panel-3) text-(--color-text-dim)">
          <div></div>
          <div className="text-right">Trades</div>
          <div className="text-right">W / L</div>
          <div></div>
          <div className="text-right">PNL</div>
        </div>
        {rows.map(r => {
          const intensity = max === 0 ? 0 : Math.abs(r.pnl) / max
          const tone = r.pnl > 0 ? 'var(--color-win)' : r.pnl < 0 ? 'var(--color-loss)' : 'var(--color-panel-2)'
          // Bar centered at 50% — winners go right, losers go left.
          const half = (intensity * 100) / 2
          return (
            <div
              key={r.label}
              className="grid grid-cols-[80px_60px_80px_1fr_80px] gap-2 py-1 items-center"
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
      <div className="grid grid-cols-[60px_60px_80px_80px_1fr] gap-2 py-1 mb-2 border-b border-(--color-panel-3) text-(--color-text-dim)">
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
            className="grid grid-cols-[60px_60px_80px_80px_1fr] gap-2 py-1 font-mono tabular-nums"
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

function RDistRows({ buckets }: { buckets: ReturnType<typeof rDistribution> }) {
  // Trim both tails. The chart should bottom at -2R and top at +5R by
  // default — empty buckets past those thresholds are just noise. Only
  // extend the range when a trade actually fell into a deeper bucket.
  let startIdx = 0
  while (
    startIdx < buckets.length - 1 &&
    buckets[startIdx].count === 0 &&
    buckets[startIdx].label !== '-2R'
  ) {
    startIdx++
  }
  let endIdx = buckets.length - 1
  while (
    endIdx > startIdx &&
    buckets[endIdx].count === 0 &&
    buckets[endIdx].label !== '+5R'
  ) {
    endIdx--
  }
  const visible = buckets.slice(startIdx, endIdx + 1)
  const max = Math.max(1, ...visible.map(b => b.count))
  const total = buckets.reduce((s, b) => s + b.count, 0)
  if (total === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) text-center py-6">
        No trades with a stop_loss in this range.
      </div>
    )
  }
  return (
    <div>
      {visible.map(b => {
        const pct = (b.count / max) * 100
        const isWin = b.range[0] >= 0
        const color = isWin ? 'var(--color-win)' : 'var(--color-loss)'
        return (
          <div key={b.label} className="grid grid-cols-[48px_1fr_28px] items-center gap-2 py-1">
            <div className="text-xs font-mono text-(--color-text-dim)">{b.label}</div>
            <div className="h-2 bg-(--color-panel-2) rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: color, opacity: b.count > 0 ? 0.85 : 0.15 }}
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
  // Measure the container so the SVG viewBox matches the real pixel
  // width — otherwise preserveAspectRatio="meet" letterboxes the chart
  // into the card and leaves big empty bands on either side. Initial
  // guess of 480 lines up with the old fixed viewBox so the first
  // paint isn't visibly off before ResizeObserver fires.
  const containerRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(480)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.max(200, Math.round(e.contentRect.width))
        setW(prev => (prev === w ? prev : w))
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  const H = 240
  const PAD_L = 50
  const PAD_R = 6
  const PAD_T = 6
  const PAD_B = 18
  if (points.length === 0) {
    return <div className="text-xs text-(--color-text-dim) text-center py-6">No trades.</div>
  }
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const xMax = Math.max(1, ...xs)
  const yMax = Math.max(1, ...ys.map(Math.abs))
  const x = (v: number) => PAD_L + (v / xMax) * (W - PAD_L - PAD_R)
  const yMid = (H - PAD_B + PAD_T) / 2
  const y = (v: number) =>
    yMid - (v / yMax) * (yMid - PAD_T)
  return (
    <div ref={containerRef} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-[240px]">
      {/* Horizontal zero line (X axis runs through PNL = 0). */}
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={y(0)}
        y2={y(0)}
        stroke="var(--color-panel-3)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        shapeRendering="crispEdges"
      />
      <line
        x1={PAD_L}
        x2={PAD_L}
        y1={PAD_T}
        y2={H - PAD_B}
        stroke="var(--color-panel-3)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        shapeRendering="crispEdges"
      />
      {/* Y labels: -max, 0, +max. X labels: 0, max. */}
      {[yMax, 0, -yMax].map(v => (
        <text
          key={`yt-${v}`}
          x={PAD_L - 10}
          y={y(v)}
          textAnchor="end"
          dominantBaseline="central"
          fontSize="10"
          fill="var(--color-text-dim)"
        >
          {formatUsd(v)}
        </text>
      ))}
      {[0, xMax].map(v => (
        <text
          key={`xt-${v}`}
          x={x(v)}
          y={H - PAD_B + 12}
          textAnchor={v === 0 ? 'start' : 'end'}
          fontSize="10"
          fill="var(--color-text-dim)"
        >
          {formatUsd(v)}
        </text>
      ))}
      {points.map(p => (
        <circle
          key={p.id}
          cx={x(p.x)}
          cy={y(p.y)}
          r={4}
          fill={
            p.outcome === 'win'
              ? 'var(--color-win)'
              : p.outcome === 'loss'
                ? 'var(--color-loss)'
                : 'var(--color-text-faint)'
          }
          fillOpacity={0.7}
          stroke={
            p.outcome === 'win'
              ? 'var(--color-win)'
              : p.outcome === 'loss'
                ? 'var(--color-loss)'
                : 'var(--color-text-faint)'
          }
          style={{ cursor: onClick ? 'pointer' : 'default' }}
          onClick={() => onClick?.(p)}
        >
          <title>
            {p.date} · {formatUsd(p.y)} · excursion {formatUsd(p.x)}
          </title>
        </circle>
      ))}
    </svg>
    </div>
  )
}

function PlannedRealizedScatter({
  points,
  onClick,
}: {
  points: Array<{ id: string; planned: number; realized: number; outcome: TradeOutcome; date: string }>
  onClick?: (p: { id: string }) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(480)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.max(200, Math.round(e.contentRect.width))
        setW(prev => (prev === w ? prev : w))
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  const H = 240
  const PAD_L = 32
  const PAD_R = 6
  const PAD_T = 6
  const PAD_B = 18
  if (points.length === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) text-center py-6">
        No trades with both planned and realised R.
      </div>
    )
  }
  const xMaxRaw = Math.max(...points.map(p => p.planned))
  const xMax = Math.max(1, Math.ceil(xMaxRaw))
  const yVals = points.map(p => p.realized)
  const yMin = Math.min(0, Math.floor(Math.min(...yVals)))
  const yMaxRaw = Math.max(...yVals, xMax)
  const yMax = Math.max(1, Math.ceil(yMaxRaw))
  const x = (v: number) => PAD_L + ((v - 0) / xMax) * (W - PAD_L - PAD_R)
  const y = (v: number) =>
    H - PAD_B - ((v - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B)
  // Tick spacing: integer R values from 0..xMax on x; integer y ticks yMin..yMax.
  const xTicks = Array.from({ length: xMax + 1 }, (_, i) => i)
  const yTicks: number[] = []
  for (let v = yMin; v <= yMax; v++) yTicks.push(v)
  return (
    <div ref={containerRef} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-[240px]">
      {/* X axis runs through y = 0 (scratch) so points above sit on
          winners-territory and points below sit on losers-territory. */}
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={y(0)}
        y2={y(0)}
        stroke="var(--color-panel-3)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        shapeRendering="crispEdges"
      />
      <line
        x1={PAD_L}
        x2={PAD_L}
        y1={PAD_T}
        y2={H - PAD_B}
        stroke="var(--color-panel-3)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        shapeRendering="crispEdges"
      />
      {yTicks.map(v => (
        <text
          key={`yt-${v}`}
          x={PAD_L - 10}
          y={y(v)}
          textAnchor="end"
          dominantBaseline="central"
          fontSize="10"
          fill="var(--color-text-dim)"
        >
          {v}R
        </text>
      ))}
      {xTicks.map(v => (
        <text
          key={`xt-${v}`}
          x={x(v)}
          y={H - PAD_B + 12}
          textAnchor="middle"
          fontSize="10"
          fill="var(--color-text-dim)"
        >
          {v}R
        </text>
      ))}
      {/* Perfect-execution diagonal y=x. Clipped to the visible area. */}
      <line
        x1={x(Math.max(0, yMin))}
        y1={y(Math.max(0, yMin))}
        x2={x(Math.min(xMax, yMax))}
        y2={y(Math.min(xMax, yMax))}
        stroke="var(--color-panel-3)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {points.map(p => (
        <circle
          key={p.id}
          cx={x(p.planned)}
          cy={y(p.realized)}
          r={4}
          fill={
            p.outcome === 'win'
              ? 'var(--color-win)'
              : p.outcome === 'loss'
                ? 'var(--color-loss)'
                : 'var(--color-text-faint)'
          }
          fillOpacity={0.7}
          stroke={
            p.outcome === 'win'
              ? 'var(--color-win)'
              : p.outcome === 'loss'
                ? 'var(--color-loss)'
                : 'var(--color-text-faint)'
          }
          style={{ cursor: onClick ? 'pointer' : 'default' }}
          onClick={() => onClick?.(p)}
        >
          <title>
            {p.date} · planned {p.planned.toFixed(2)}R · realised {p.realized.toFixed(2)}R
          </title>
        </circle>
      ))}
    </svg>
    </div>
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
