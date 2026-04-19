import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CandlePoint } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'

interface FeesChartProps {
  points: CandlePoint[]
  height?: number
}

const LEFT_AXIS_W = 64

export function FeesChart({ points, height = 140 }: FeesChartProps) {
  const data = useMemo(() => points.map(p => ({ key: p.key, label: p.label, fees: p.fees })), [points])
  const hasFees = points.some(p => p.fees > 0)

  return (
    <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-(--color-text-dim) uppercase tracking-wider">Fees paid</span>
      </div>
      {hasFees ? (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} syncId="equity">
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
              />
              <YAxis
                width={LEFT_AXIS_W}
                tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => formatUsd(v)}
              />
              <Tooltip
                cursor={{ fill: 'var(--color-panel-2)', opacity: 0.5 }}
                contentStyle={{
                  background: 'var(--color-panel-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--color-text-dim)' }}
                formatter={(v) => [formatUsd(Number(v)), 'fees']}
              />
              <Bar dataKey="fees" barSize={10} fill="var(--color-fee)" fillOpacity={0.85} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-sm text-(--color-text-dim) text-center py-8">No fees in this period.</div>
      )}
    </div>
  )
}
