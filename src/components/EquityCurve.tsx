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
import { formatUsd } from '@/lib/money'

export interface EquityPoint {
  key: string // bucket id, used on X axis
  label: string // display label for x-axis + tooltip
  pnl: number // net PnL for the bucket
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
}

export function EquityCurve({ points, cumulative = true, height = 180 }: EquityCurveProps) {
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
    <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-(--color-text-dim) uppercase tracking-wider">
          {cumulative ? 'Equity curve' : 'PnL by period'}
        </span>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-border)' }}
            />
            <YAxis
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={v => formatUsd(v)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-border)' }}
              contentStyle={{
                background: 'var(--color-panel-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: 'var(--color-text-dim)' }}
              formatter={(v) => [formatUsd(Number(v)), cumulative ? 'Equity' : 'PnL']}
            />
            <Line
              type="monotone"
              dataKey="y"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={{ r: 2, fill: 'var(--color-accent)' }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="text-sm text-(--color-text-dim) text-center py-8">No data in this period.</div>
      )}
    </div>
  )
}
