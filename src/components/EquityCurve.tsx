import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
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
}

export function EquityCurve({ points, cumulative = true, height = 360, xTicks, headerRight }: EquityCurveProps) {
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
          <LineChart data={data} margin={{ top: 28, right: 12, left: 8, bottom: 0 }} syncId="equity">
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} shapeRendering="crispEdges" />
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
            <Line
              type="linear"
              dataKey="y"
              stroke="var(--color-line)"
              strokeWidth={1.5}
              shapeRendering="geometricPrecision"
              dot={{ r: 2, fill: 'var(--color-line)' }}
              activeDot={{ r: 4 }}
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
