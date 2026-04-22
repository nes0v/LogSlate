import { useMemo } from 'react'
import {
  Bar,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format } from 'date-fns'
import { ChartHoverCursor } from '@/components/ChartHoverCursor'
import { chartDayLabel } from '@/lib/buckets'
import type { CandlePoint } from '@/lib/trade-stats'
import { niceDomain } from '@/lib/chart'
import { setHoverLabel, useHoverLabel } from '@/lib/hover-cursor'
import { formatUsd } from '@/lib/money'

interface FeesChartProps {
  points: CandlePoint[]
  height?: number
  /** Explicit X-axis tick values (must match point labels). */
  xTicks?: string[]
}

const LEFT_AXIS_W = 60

export function FeesChart({ points, height = 180, xTicks }: FeesChartProps) {
  const data = useMemo(
    () => points.map(p => ({ key: p.key, label: p.label, fees: p.fees, count: p.count })),
    [points],
  )
  const hasFees = points.some(p => p.fees > 0)
  const domain = useMemo<[number, number]>(() => {
    if (points.length === 0) return [0, 1]
    let max = 0
    for (const p of points) {
      if (p.fees > max) max = p.fees
    }
    return niceDomain(0, max)
  }, [points])

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Fees</h2>
      <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
      {hasFees ? (
        <ResponsiveContainer width="100%" height={height} minWidth={0} minHeight={0}>
          <ComposedChart
            data={data}
            margin={{ top: 28, right: 12, left: 8, bottom: 0 }}
            syncId="equity"
            onMouseMove={state => {
              const label = state?.activeLabel
              setHoverLabel(typeof label === 'string' ? label : null)
            }}
            onMouseLeave={() => setHoverLabel(null)}
          >
            <ChartHoverCursor />
            <XAxis
              dataKey="label"
              scale="point"
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => chartDayLabel(String(v))}
              padding={{ left: 18, right: 18 }}
              {...(xTicks ? { ticks: xTicks, interval: 0 as const } : {})}
            />
            <YAxis
              width={LEFT_AXIS_W}
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              domain={domain}
              tickFormatter={v => formatUsd(v)}
            />
            <Tooltip cursor={false} content={<FeesTooltip />} position={{ x: 76, y: 8 }} />
            <Bar
              dataKey="fees"
              maxBarSize={18}
              fill="var(--color-fee)"
              isAnimationActive={false}
              activeBar={{ stroke: '#fff', strokeWidth: 2 }}
            />
          </ComposedChart>
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
  fees?: number
  count?: number
}

interface FeesTooltipProps {
  active?: boolean
  payload?: Array<{ payload: TooltipPayload }>
}

function FeesTooltip({ active, payload }: FeesTooltipProps) {
  const hoverLabel = useHoverLabel()
  if (!hoverLabel) return null
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  const dateLabel = p.key ? format(new Date(p.key + 'T00:00:00'), 'MMM d') : p.label ?? ''
  return (
    <div className="bg-(--color-panel-2) border border-(--color-border) rounded-md p-2 text-xs font-mono">
      <div className="text-(--color-text-dim) mb-2">{dateLabel}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-(--color-text-dim)">fees</span>
        <span>{formatUsd(p.fees ?? 0)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-(--color-text-dim)">trades</span>
        <span>{p.count ?? 0}</span>
      </div>
    </div>
  )
}
