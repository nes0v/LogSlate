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
import { formatUsd } from '@/lib/money'

export interface EquityPoint {
  key: string // bucket id, used on X axis
  label: string // display label for x-axis + tooltip
  pnl: number // net PnL for the bucket
  count?: number // number of trades in the bucket (for tooltip)
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
  height?: number
  /** Explicit X-axis tick values (must match point labels). */
  xTicks?: string[]
  /** Optional element to render on the right of the section header. */
  headerRight?: React.ReactNode
  /** Dashed vertical markers drawn at each deposit/withdrawal date. */
  adjustments?: AdjustmentMarker[]
  /** Fired when a point/area in the chart is clicked — gets the bucket key. */
  onPointClick?: (key: string) => void
  /** X-axis label currently hovered (shared across charts for cursor sync). */
  hoverLabel?: string | null
  /** Notifies the parent when the hovered X label changes. */
  onHoverLabel?: (label: string | null) => void
}

export function EquityCurve({
  points,
  cumulative = true,
  height = 360,
  xTicks,
  headerRight,
  adjustments,
  onPointClick,
  onHoverLabel,
}: EquityCurveProps) {
  const data = useMemo(() => {
    if (!cumulative) return points.map(p => ({ ...p, y: p.pnl }))
    let running = 0
    return points.map(p => {
      running += p.pnl
      return { ...p, y: running }
    })
  }, [points, cumulative])

  const hasData = data.length > 0

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{cumulative ? 'Equity' : 'PnL by period'}</h2>
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
              if (!onHoverLabel) return
              const label = state?.activeLabel
              onHoverLabel(typeof label === 'string' ? label : null)
            }}
            onMouseLeave={() => onHoverLabel?.(null)}
          >
            {adjustments && adjustments.length > 0 && (
              <CartesianGrid
                horizontal={false}
                stroke="#374151"
                strokeDasharray="3 3"
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
              padding={{ left: 18, right: 18 }}
              {...(xTicks ? { ticks: xTicks, interval: 0 as const } : {})}
            />
            <YAxis
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={60}
              tickMargin={10}
              tickFormatter={v => formatUsd(v)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-text-dim)', strokeWidth: 1, strokeDasharray: '3 3', shapeRendering: 'crispEdges' }}
              content={<EquityTooltip cumulative={cumulative} />}
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
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill="var(--color-line)"
                    stroke="#fff"
                    strokeWidth={2}
                    onClick={() => {
                      const key = payload?.key
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

interface TooltipPayload {
  key?: string
  label?: string
  count?: number
  y?: number
  pnl?: number
}

interface EquityTooltipProps {
  active?: boolean
  payload?: Array<{ payload: TooltipPayload }>
  cumulative: boolean
}

function EquityTooltip({ active, payload, cumulative }: EquityTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  const dateLabel = p.key ? format(new Date(p.key + 'T00:00:00'), 'MMM d') : p.label ?? ''
  const value = p.y ?? p.pnl ?? 0
  return (
    <div className="bg-(--color-panel-2) border border-(--color-border) rounded-md p-2 text-xs font-mono">
      <div className="text-(--color-text-dim) mb-2">{dateLabel}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-(--color-text-dim)">{cumulative ? 'equity' : 'pnl'}</span>
        <span>{formatUsd(value)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-(--color-text-dim)">trades</span>
        <span>{p.count ?? 0}</span>
      </div>
    </div>
  )
}
