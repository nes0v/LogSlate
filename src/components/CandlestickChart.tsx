import { useMemo } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AdjustmentMarker } from '@/components/EquityCurve'
import { format } from 'date-fns'
import type { CandlePoint } from '@/lib/trade-stats'
import { niceDomain } from '@/lib/chart'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

interface CandlestickChartProps {
  points: CandlePoint[]
  height?: number
  /** Explicit X-axis tick values (must match point labels). */
  xTicks?: string[]
  /** Optional element to render on the right of the section header. */
  headerRight?: React.ReactNode
  /** Dashed vertical markers drawn at each deposit/withdrawal date. */
  adjustments?: AdjustmentMarker[]
}

interface Row extends CandlePoint {
  wick: [number, number]
  up: boolean
}

const LEFT_AXIS_W = 60

export function CandlestickChart({
  points,
  height = 360,
  xTicks,
  headerRight,
  adjustments,
}: CandlestickChartProps) {
  const data: Row[] = useMemo(
    () =>
      points.map(p => ({
        ...p,
        wick: [p.low, p.high],
        up: p.close >= p.open,
      })),
    [points],
  )

  const domain = useMemo<[number, number]>(() => {
    if (points.length === 0) return [0, 1]
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      if (p.low < min) min = p.low
      if (p.high > max) max = p.high
    }
    return niceDomain(min, max)
  }, [points])

  const hasData = points.length > 0 && points.some(p => p.count > 0)

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Equity</h2>
        {headerRight}
      </div>
      <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
      {hasData ? (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 28, right: 12, left: 8, bottom: 0 }}
              syncId="equity"
            >
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} shapeRendering="crispEdges" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                padding={{ left: 0, right: 0 }}
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
              <Tooltip
                content={<CandleTooltip />}
                cursor={{ stroke: 'var(--color-text-dim)', strokeWidth: 1, strokeDasharray: '3 3', shapeRendering: 'crispEdges' }}
              />
              {adjustments?.map(a => {
                const color = a.amount >= 0 ? 'var(--color-win)' : 'var(--color-loss)'
                const label = `${a.amount >= 0 ? '+' : '−'}${formatUsd(Math.abs(a.amount))}`
                return (
                  <ReferenceLine
                    key={a.x}
                    x={a.x}
                    stroke={color}
                    strokeDasharray="3 3"
                    shapeRendering="crispEdges"
                    label={{
                      value: label,
                      position: 'top',
                      offset: 16,
                      fill: color,
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                )
              })}
              <Bar dataKey="wick" isAnimationActive={false} shape={CandleShape} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-sm text-(--color-text-dim) text-center py-8">No data in this period.</div>
      )}
      </div>
    </section>
  )
}

interface CandleShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: Row
}

function CandleShape(props: CandleShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props
  if (!payload) return null
  const { open, close, high, low, up, count } = payload
  if (count === 0) return null // Adjustment-only days are drawn via ReferenceLine.

  const cx = x + width / 2
  const bodyW = Math.max(Math.min(width * 0.75, 18), 2)
  const range = Math.max(high - low, 1e-9)
  const priceY = (v: number) => y + ((high - v) / range) * height
  const bodyTop = priceY(Math.max(open, close))
  const bodyBottom = priceY(Math.min(open, close))
  const bodyH = Math.max(bodyBottom - bodyTop, 1)
  const color = up ? 'var(--color-win)' : 'var(--color-loss)'
  // Snap the wick to half-pixel x so a 1px stroke lands on a whole pixel.
  const wickX = Math.round(cx) + 0.5
  return (
    <g shapeRendering="crispEdges">
      <line x1={wickX} x2={wickX} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect
        x={Math.round(cx - bodyW / 2)}
        y={Math.round(bodyTop)}
        width={Math.round(bodyW)}
        height={Math.max(Math.round(bodyH), 1)}
        fill={color}
        stroke="none"
      />
    </g>
  )
}

interface TooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload: Row }>
}

function CandleTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  const labelText = p.key ? format(new Date(p.key + 'T00:00:00'), 'MMM d') : p.label
  return (
    <div className="bg-(--color-panel-2) border border-(--color-border) rounded-md p-2 text-xs font-mono">
      <div className="text-(--color-text-dim) mb-2">{labelText}</div>
      <TooltipRow k="O" v={formatUsd(p.open)} />
      <TooltipRow k="H" v={formatUsd(p.high)} />
      <TooltipRow k="L" v={formatUsd(p.low)} />
      <TooltipRow k="C" v={formatUsd(p.close)} />
      <TooltipRow
        k="Δ"
        v={formatUsd(p.close - p.open - p.adjustment)}
        tone={
          p.close - p.open - p.adjustment > 0
            ? 'win'
            : p.close - p.open - p.adjustment < 0
              ? 'loss'
              : 'dim'
        }
      />
      <TooltipRow k="trades" v={String(p.count)} />
    </div>
  )
}

function TooltipRow({ k, v, tone }: { k: string; v: string; tone?: 'win' | 'loss' | 'dim' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-(--color-text-dim)">{k}</span>
      <span
        className={cn(
          tone === 'win' && 'text-(--color-win)',
          tone === 'loss' && 'text-(--color-loss)',
          tone === 'dim' && 'text-(--color-text-dim)',
        )}
      >
        {v}
      </span>
    </div>
  )
}
