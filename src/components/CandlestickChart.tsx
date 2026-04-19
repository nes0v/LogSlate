import { useMemo } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CandlePoint } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

interface CandlestickChartProps {
  points: CandlePoint[]
  height?: number
}

interface Row extends CandlePoint {
  wick: [number, number]
  up: boolean
}

const LEFT_AXIS_W = 64

export function CandlestickChart({ points, height = 240 }: CandlestickChartProps) {
  const data: Row[] = useMemo(
    () =>
      points.map(p => ({
        ...p,
        wick: [p.low, p.high],
        up: p.close >= p.open,
      })),
    [points],
  )

  const hasData = points.length > 0 && points.some(p => p.count > 0)

  return (
    <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-(--color-text-dim) uppercase tracking-wider">
          Equity candles
        </span>
      </div>
      {hasData ? (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              syncId="equity"
            >
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
                domain={['dataMin', 'dataMax']}
                tickFormatter={v => formatUsd(v)}
              />
              <Tooltip content={<CandleTooltip />} cursor={{ fill: 'var(--color-panel-2)', opacity: 0.5 }} />
              <Bar dataKey="wick" isAnimationActive={false} shape={CandleShape} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-sm text-(--color-text-dim) text-center py-8">No data in this period.</div>
      )}
    </div>
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
  const { open, close, high, low, up } = payload
  const range = Math.max(high - low, 1e-9)
  const priceY = (v: number) => y + ((high - v) / range) * height
  const bodyTop = priceY(Math.max(open, close))
  const bodyBottom = priceY(Math.min(open, close))
  const bodyH = Math.max(bodyBottom - bodyTop, 1)
  const cx = x + width / 2
  const bodyW = Math.max(Math.min(width * 0.65, 14), 2)
  const color = up ? 'var(--color-win)' : 'var(--color-loss)'
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} shapeRendering="crispEdges" />
      <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} stroke={color} />
    </g>
  )
}

interface TooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload: Row }>
}

function CandleTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  return (
    <div className="bg-(--color-panel-2) border border-(--color-border) rounded-md p-2 text-xs font-mono">
      <div className="text-(--color-text-dim) mb-1">{label}</div>
      <TooltipRow k="O" v={formatUsd(p.open)} />
      <TooltipRow k="H" v={formatUsd(p.high)} tone="win" />
      <TooltipRow k="L" v={formatUsd(p.low)} tone="loss" />
      <TooltipRow k="C" v={formatUsd(p.close)} tone={p.close > p.open ? 'win' : p.close < p.open ? 'loss' : 'dim'} />
      <TooltipRow k="Δ" v={formatUsd(p.close - p.open)} tone={p.close > p.open ? 'win' : p.close < p.open ? 'loss' : 'dim'} />
      <TooltipRow k="trades" v={String(p.count)} tone="dim" />
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
