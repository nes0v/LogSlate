import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  candleHeight?: number
  feesHeight?: number
}

interface Row extends CandlePoint {
  wick: [number, number] // [low, high] — renders as a range bar (the full wick)
  body: [number, number] // [min(open, close), max(open, close)] — candle body range bar
  up: boolean
}

export function CandlestickChart({
  points,
  candleHeight = 240,
  feesHeight = 72,
}: CandlestickChartProps) {
  const data: Row[] = useMemo(
    () =>
      points.map(p => {
        const up = p.close >= p.open
        return {
          ...p,
          wick: [p.low, p.high],
          body: [Math.min(p.open, p.close), Math.max(p.open, p.close)],
          up,
        }
      }),
    [points],
  )

  const hasData = points.length > 0 && points.some(p => p.count > 0)
  const hasFees = points.some(p => p.fees > 0)

  // Shared left axis width keeps the two stacked charts visually aligned.
  const leftAxisWidth = 64

  return (
    <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-(--color-text-dim) uppercase tracking-wider">
          Equity candles · fees (volume)
        </span>
      </div>

      {hasData ? (
        <div className="flex flex-col">
          <div style={{ height: candleHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                syncId="equity"
              >
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis dataKey="label" hide />
                <YAxis
                  width={leftAxisWidth}
                  tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={v => formatUsd(v)}
                />
                <Tooltip content={<CandleTooltip />} cursor={{ fill: 'var(--color-panel-2)', opacity: 0.5 }} />
                {/* Wick: thin range bar from low to high */}
                <Bar dataKey="wick" barSize={1} isAnimationActive={false}>
                  {data.map((p, i) => (
                    <Cell key={i} fill={p.up ? 'var(--color-win)' : 'var(--color-loss)'} />
                  ))}
                </Bar>
                {/* Body: thicker range bar between open and close */}
                <Bar dataKey="body" barSize={10} isAnimationActive={false} radius={1}>
                  {data.map((p, i) => (
                    <Cell key={i} fill={p.up ? 'var(--color-win)' : 'var(--color-loss)'} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div style={{ height: feesHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} syncId="equity">
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-border)' }}
                />
                <YAxis
                  width={leftAxisWidth}
                  tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => formatUsd(v)}
                />
                <Tooltip content={<FeesTooltip />} cursor={{ fill: 'var(--color-panel-2)', opacity: 0.5 }} />
                <Bar
                  dataKey="fees"
                  barSize={10}
                  fill="var(--color-text-dim)"
                  fillOpacity={hasFees ? 0.6 : 0.2}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="text-sm text-(--color-text-dim) text-center py-8">No data in this period.</div>
      )}
    </div>
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

function FeesTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  return (
    <div className="bg-(--color-panel-2) border border-(--color-border) rounded-md p-2 text-xs font-mono">
      <div className="text-(--color-text-dim) mb-1">{label}</div>
      <TooltipRow k="fees" v={formatUsd(p.fees)} tone="dim" />
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
