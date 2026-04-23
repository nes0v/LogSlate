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
import { ChartHoverCursor } from '@/components/ChartHoverCursor'
import { chartDayLabel } from '@/lib/buckets'
import type { CandlePoint } from '@/lib/trade-stats'
import { EQUITY_Y_PAD, niceDomain } from '@/lib/chart'
import { setHoverLabel, useHoverLabel } from '@/lib/hover-cursor'
import { formatUsd } from '@/lib/money'
import { useIsNarrowScreen } from '@/lib/use-media-query'
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
  /** Fired when a candle is clicked — gets the bucket key. */
  onPointClick?: (key: string) => void
}

interface Row extends CandlePoint {
  wick: [number, number]
  up: boolean
}

const LEFT_AXIS_W = 60

export function CandlestickChart({
  points,
  height = 420,
  xTicks,
  headerRight,
  adjustments,
  onPointClick,
}: CandlestickChartProps) {
  const isNarrow = useIsNarrowScreen()
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
    return niceDomain(min - EQUITY_Y_PAD, max + EQUITY_Y_PAD)
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
        <ResponsiveContainer width="100%" height={height} minWidth={0} minHeight={0}>
            <ComposedChart
              data={data}
              margin={{ top: 28, right: 12, left: 8, bottom: 0 }}
              syncId="equity"
              onClick={state => {
                if (!onPointClick) return
                const i = state?.activeTooltipIndex
                if (typeof i !== 'number') return
                const point = data[i]
                if (point?.key) onPointClick(point.key)
              }}
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
                hide={isNarrow}
                width={LEFT_AXIS_W}
                tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                domain={domain}
                tickFormatter={v => formatUsd(v)}
              />
              <Tooltip content={<CandleTooltip />} cursor={false} position={{ x: 76, y: 8 }} />
              {/* Labels only — the visible line is drawn by the CartesianGrid
                  above so it renders beneath the candles. */}
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
              <Bar
                dataKey="wick"
                isAnimationActive={false}
                shape={props => <CandleShape {...props} onPointClick={onPointClick} />}
                activeBar={props => <CandleShape {...props} onPointClick={onPointClick} active />}
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

interface CandleShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: Row
  onPointClick?: (key: string) => void
  active?: boolean
}

function CandleShape(props: CandleShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload, onPointClick, active } = props
  if (!payload) return null
  const { open, close, high, low, up, count, key } = payload
  if (count === 0) return null // Adjustment-only days are drawn via ReferenceLine.

  const cx = x + width / 2
  const bodyW = Math.max(Math.min(width * 0.75, 18), 2)
  const range = Math.max(high - low, 1e-9)
  const priceY = (v: number) => y + ((high - v) / range) * height
  const bodyTop = priceY(Math.max(open, close))
  const bodyBottom = priceY(Math.min(open, close))
  const bodyTopY = Math.round(bodyTop)
  const bodyBotY = Math.round(bodyBottom)
  const bodyH = Math.max(bodyBotY - bodyTopY, 1)
  const color = up ? 'var(--color-win)' : 'var(--color-loss)'
  // Snap the wick to half-pixel x so a 1px stroke lands on a whole pixel.
  const wickX = Math.round(cx) + 0.5
  const handleClick = onPointClick ? () => onPointClick(key) : undefined
  const bandW = Math.max(width, 2)
  // Only render wick segments that actually extend beyond the body. Compare
  // at the pixel level so float noise doesn't produce phantom 1px wicks
  // when high === max(open, close) or low === min(open, close).
  const wickTopY = Math.round(y)
  const wickBotY = Math.round(y + height)
  const hasUpperWick = wickTopY < bodyTopY
  const hasLowerWick = wickBotY > bodyBotY
  return (
    <g
      shapeRendering="crispEdges"
      onClick={handleClick}
      style={handleClick ? { cursor: 'pointer' } : undefined}
    >
      {/* Invisible click-target covers the full band so the whole column is clickable. */}
      {handleClick && (
        <rect x={x} y={y} width={bandW} height={height} fill="transparent" />
      )}
      {hasUpperWick && (
        <line
          x1={wickX}
          x2={wickX}
          y1={wickTopY}
          y2={bodyTopY}
          stroke={active ? '#fff' : color}
          strokeWidth={1}
        />
      )}
      {hasLowerWick && (
        <line
          x1={wickX}
          x2={wickX}
          y1={bodyBotY}
          y2={wickBotY}
          stroke={active ? '#fff' : color}
          strokeWidth={1}
        />
      )}
      <rect
        x={Math.round(cx - bodyW / 2)}
        y={bodyTopY}
        width={Math.round(bodyW)}
        height={bodyH}
        fill={color}
        stroke={active ? '#fff' : 'none'}
        strokeWidth={active ? 1 : 0}
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
  const hoverLabel = useHoverLabel()
  if (!hoverLabel) return null
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
        v={formatUsd(p.close - p.open)}
        tone={p.close > p.open ? 'win' : p.close < p.open ? 'loss' : 'dim'}
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
