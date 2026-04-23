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
import { setHoverLabel, useHoverLabel } from '@/lib/hover-cursor'
import { formatUsd } from '@/lib/money'
import { useIsNarrowScreen } from '@/lib/use-media-query'

interface FeesChartProps {
  points: CandlePoint[]
  height?: number
  /** Explicit X-axis tick values (must match point labels). */
  xTicks?: string[]
  /** Fired when a bar is clicked — gets the bucket key. */
  onPointClick?: (key: string) => void
}

const LEFT_AXIS_W = 60

export function FeesChart({ points, height = 180, xTicks, onPointClick }: FeesChartProps) {
  const isNarrow = useIsNarrowScreen()
  const data = useMemo(
    () => points.map(p => ({ key: p.key, label: p.label, fees: p.fees, count: p.count })),
    [points],
  )
  const hasFees = points.some(p => p.fees > 0)
  const { domain, yTicks } = useMemo<{ domain: [number, number]; yTicks: number[] }>(() => {
    if (points.length === 0) return { domain: [0, 5], yTicks: [0, 5] }
    let max = 0
    for (const p of points) {
      if (p.fees > max) max = p.fees
    }
    const top = Math.ceil((max + 3) / 5) * 5
    const ticks: number[] = []
    for (let v = 0; v <= top; v += 5) ticks.push(v)
    return { domain: [0, top], yTicks: ticks }
  }, [points])

  return (
    <section className="space-y-2">
      <div className="relative flex items-end min-h-[26px]">
        <h2 className="text-sm font-medium">Fees</h2>
        {hasFees && <FeesInfoRow data={data} />}
      </div>
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
              hide={isNarrow}
              width={LEFT_AXIS_W}
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              domain={domain}
              ticks={yTicks}
              tickFormatter={v => formatUsd(v)}
            />
            <Tooltip content={() => null} cursor={false} isAnimationActive={false} />
            <Bar
              dataKey="fees"
              maxBarSize={18}
              fill="var(--color-fee)"
              shapeRendering="crispEdges"
              isAnimationActive={false}
              shape={props => <FeesBar {...props} onPointClick={onPointClick} />}
              activeBar={props => <FeesBar {...props} onPointClick={onPointClick} active />}
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

type FeesRow = Pick<CandlePoint, 'key' | 'label' | 'fees' | 'count'>

function FeesInfoRow({ data }: { data: FeesRow[] }) {
  const hoverLabel = useHoverLabel()
  const row = hoverLabel ? data.find(d => d.label === hoverLabel) : null
  if (!row) return null
  const dateLabel = row.key ? format(new Date(row.key + 'T00:00:00'), 'MMM d') : row.label
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center gap-x-4 text-xs font-mono bg-(--color-panel-2) border border-(--color-border) rounded-md px-2 py-1 pointer-events-none whitespace-nowrap">
      <span className="text-(--color-text-dim)">{dateLabel}</span>
      {row.fees > 0 && (
        <span className="inline-flex items-center gap-1">
          <span className="text-(--color-text-dim)">fees</span>
          <span>{formatUsd(row.fees)}</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <span className="text-(--color-text-dim)">trades</span>
        <span>{row.count}</span>
      </span>
    </div>
  )
}

interface FeesBarProps {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  payload?: { key?: string; fees?: number }
  onPointClick?: (key: string) => void
  active?: boolean
}

function FeesBar(props: FeesBarProps) {
  const { x = 0, y = 0, width = 0, height = 0, fill, payload, onPointClick, active } = props
  const rx = Math.round(x)
  const ry = Math.round(y)
  const rw = Math.round(width)
  const rh = Math.round(height)
  if (rw <= 0 || rh <= 0) return null
  const key = payload?.key
  const handleClick = key && onPointClick ? () => onPointClick(key) : undefined
  return (
    <g shapeRendering="crispEdges">
      <rect
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        fill={fill}
        onClick={handleClick}
        style={handleClick ? { cursor: 'pointer' } : undefined}
      />
      {active && (
        <rect
          x={rx + 0.5}
          y={ry + 0.5}
          width={Math.max(rw - 1, 0)}
          height={Math.max(rh - 1, 0)}
          fill="none"
          stroke="#fff"
          strokeWidth={1}
          pointerEvents="none"
        />
      )}
    </g>
  )
}

