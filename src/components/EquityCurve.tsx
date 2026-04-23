import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format } from 'date-fns'
import { chartDayLabel } from '@/lib/buckets'
import { EQUITY_Y_PAD, niceDomain } from '@/lib/chart'
import { setHoverLabel, useHoverLabel } from '@/lib/hover-cursor'
import { formatUsd } from '@/lib/money'
import { useIsNarrowScreen } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

export interface EquityPoint {
  key: string // bucket id, used on X axis
  label: string // display label for x-axis + tooltip
  pnl: number // change in equity for the bucket (net trading PnL + adjustment)
  count?: number // number of trades in the bucket (for tooltip)
  adjustment?: number // signed cash flow on this bucket (deposit+ / withdraw-)
}

export interface AdjustmentMarker {
  /** X-axis value (must match a point's label). */
  x: string
  /** Signed amount — positive for deposits, negative for withdrawals. */
  amount: number
}

interface EquityCurveProps {
  points: EquityPoint[]
  /**
   * If true, the Y value is the running cumulative total of `pnl` across
   * buckets (typical equity curve). If false, each point is the bucket's own
   * PnL (bar-chart-like line).
   */
  cumulative?: boolean
  /**
   * Seed value for the cumulative running total (e.g. account equity before
   * the first point in the series). Ignored when `cumulative` is false.
   */
  startEquity?: number
  height?: number
  /** Explicit X-axis tick values (must match point labels). */
  xTicks?: string[]
  /** Optional element to render on the right of the section header. */
  headerRight?: React.ReactNode
  /** Dashed vertical markers drawn at each deposit/withdrawal date. */
  adjustments?: AdjustmentMarker[]
  /** Fired when a point/area in the chart is clicked — gets the bucket key. */
  onPointClick?: (key: string) => void
}

type EquityRow = EquityPoint & { y: number }

export function EquityCurve({
  points,
  cumulative = true,
  startEquity = 0,
  height = 420,
  xTicks,
  headerRight,
  adjustments,
  onPointClick,
}: EquityCurveProps) {
  const isNarrow = useIsNarrowScreen()
  const data = useMemo<EquityRow[]>(() => {
    if (!cumulative) return points.map(p => ({ ...p, y: p.pnl }))
    let running = startEquity
    return points.map(p => {
      running += p.pnl
      return { ...p, y: running }
    })
  }, [points, cumulative, startEquity])

  const domain = useMemo<[number, number]>(() => {
    if (data.length === 0) return [0, 1]
    let min = Infinity
    let max = -Infinity
    for (const p of data) {
      if (p.y < min) min = p.y
      if (p.y > max) max = p.y
    }
    return niceDomain(min - EQUITY_Y_PAD, max + EQUITY_Y_PAD)
  }, [data])

  const hasData = data.length > 0 && data.some(p => (p.count ?? 0) > 0)

  return (
    <section className="space-y-2">
      <div className="relative flex items-end justify-between">
        <h2 className="text-sm font-medium">{cumulative ? 'Equity' : 'PnL by period'}</h2>
        {hasData && <EquityInfoRow data={data} cumulative={cumulative} />}
        {headerRight}
      </div>
      <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={data}
            margin={{ top: 28, right: 12, left: 8, bottom: 0 }}
            syncId="equity"
            onMouseMove={state => {
              const label = state?.activeLabel
              setHoverLabel(typeof label === 'string' ? label : null)
            }}
            onMouseLeave={() => setHoverLabel(null)}
          >
            {adjustments && adjustments.length > 0 && (
              <CartesianGrid
                horizontal={false}
                stroke="#374151"
                strokeDasharray="1 3"
                shapeRendering="crispEdges"
                verticalCoordinatesGenerator={({ xAxis }) => {
                  if (!xAxis?.scale) return []
                  const out: number[] = []
                  for (const a of adjustments) {
                    const x = xAxis.scale.map(a.x, { position: 'middle' })
                    if (typeof x === 'number' && !Number.isNaN(x)) out.push(x)
                  }
                  return out
                }}
              />
            )}
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => chartDayLabel(String(v))}
              padding={{ left: 18, right: 18 }}
              {...(xTicks ? { ticks: xTicks, interval: 0 as const } : {})}
            />
            <YAxis
              hide={isNarrow}
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={60}
              tickMargin={10}
              domain={domain}
              tickFormatter={v => formatUsd(v)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-text-dim)', strokeWidth: 1, strokeDasharray: '1 3', shapeRendering: 'crispEdges' }}
              content={() => null}
              isAnimationActive={false}
            />
            {/* Labels only — the visible line is drawn by the CartesianGrid
                above so it renders beneath the curve. */}
            {adjustments?.map(a => {
              const textColor = a.amount >= 0 ? 'var(--color-win)' : 'var(--color-loss)'
              const label = `${a.amount >= 0 ? '+' : '−'}${formatUsd(Math.abs(a.amount))}`
              return (
                <ReferenceLine
                  key={a.x}
                  x={a.x}
                  stroke="transparent"
                  label={{
                    value: label,
                    position: 'top',
                    offset: 16,
                    fill: textColor,
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              )
            })}
            <Line
              type="linear"
              dataKey="y"
              stroke="var(--color-line)"
              strokeWidth={1.5}
              shapeRendering="geometricPrecision"
              dot={{ r: 4, fill: 'var(--color-line)' }}
              activeDot={(dotProps: { cx?: number; cy?: number; payload?: { key?: string } }) => {
                const { cx, cy, payload } = dotProps
                if (typeof cx !== 'number' || typeof cy !== 'number') return <></>
                const key = payload?.key
                const clickable = Boolean(key && onPointClick)
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill="var(--color-line)"
                    stroke="#fff"
                    strokeWidth={2}
                    style={clickable ? { cursor: 'pointer' } : undefined}
                    onClick={() => {
                      if (key && onPointClick) onPointClick(key)
                    }}
                  />
                )
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="text-sm text-(--color-text-dim) text-center py-8">No data in this period.</div>
      )}
      </div>
    </section>
  )
}

function EquityInfoRow({ data, cumulative }: { data: EquityRow[]; cumulative: boolean }) {
  const hoverLabel = useHoverLabel()
  const row = hoverLabel ? data.find(d => d.label === hoverLabel) : null
  if (!row) return null
  const dateLabel = row.key ? format(new Date(row.key + 'T00:00:00'), 'MMM d') : row.label
  const value = row.y
  const delta = row.pnl ?? 0
  const tradingPnl = delta - (row.adjustment ?? 0)
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center gap-x-4 text-xs font-mono bg-(--color-panel-2) border border-(--color-border) rounded-md px-2 py-1 pointer-events-none whitespace-nowrap">
      <span className="text-(--color-text-dim)">{dateLabel}</span>
      <InfoCell label={cumulative ? 'equity' : 'pnl'} value={formatUsd(value)} />
      {cumulative && tradingPnl !== 0 && (
        <InfoCell
          label="pnl"
          value={formatUsd(tradingPnl)}
          tone={tradingPnl > 0 ? 'win' : 'loss'}
        />
      )}
      {cumulative && delta !== 0 && delta !== tradingPnl && (
        <InfoCell
          label="Δ"
          value={formatUsd(delta)}
          tone={delta > 0 ? 'win' : 'loss'}
        />
      )}
      <InfoCell label="trades" value={String(row.count ?? 0)} />
    </div>
  )
}

function InfoCell({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'win' | 'loss' | 'dim'
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-(--color-text-dim)">{label}</span>
      <span
        className={cn(
          tone === 'win' && 'text-(--color-win)',
          tone === 'loss' && 'text-(--color-loss)',
          tone === 'dim' && 'text-(--color-text-dim)',
        )}
      >
        {value}
      </span>
    </span>
  )
}

