import { useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface DonutSegment {
  label: string
  value: number
  /** CSS color or `var(--…)`. */
  color: string
}

interface DonutChartProps {
  title: string
  segments: DonutSegment[]
  /** Optional inner label, e.g. "248 trades". Falls back to total count. */
  centerLabel?: string
  className?: string
}

// Lightweight SVG donut chart. No deps. Renders the donut on the left
// and a percentage/count legend on the right. Segments with `value === 0`
// are dropped from the visual ring but kept in the legend so toggling
// outcomes feels stable across renders.
interface Tip {
  x: number
  y: number
  label: string
  value: number
}

export function DonutChart({ title, segments, centerLabel, className }: DonutChartProps) {
  const total = segments.reduce((n, s) => n + s.value, 0)
  const R = 50
  const visible = segments.filter(s => s.value > 0)
  const [tip, setTip] = useState<Tip | null>(null)

  function bindHover(s: DonutSegment) {
    return {
      onMouseEnter: (e: React.MouseEvent) =>
        setTip({ x: e.clientX, y: e.clientY, label: s.label, value: s.value }),
      onMouseMove: (e: React.MouseEvent) =>
        setTip(prev =>
          prev ? { ...prev, x: e.clientX, y: e.clientY } : prev,
        ),
      onMouseLeave: () => setTip(null),
      style: { cursor: 'pointer' },
    }
  }

  // Pie slices as filled SVG wedges. To remove the seam where colours meet,
  // we first paint a full disc in the first slice's colour and then paint
  // each subsequent slice on top — every boundary now sits over a solid
  // underlying disc, so anti-aliased edges blend with another slice colour
  // instead of the panel background.
  let cursor = -Math.PI / 2 // start at 12 o'clock
  const slices = visible.map((s, i) => {
    const fraction = s.value / total
    const startAngle = cursor
    const endAngle = cursor + fraction * 2 * Math.PI
    cursor = endAngle

    // First slice = the underlying disc.
    if (i === 0 || fraction >= 1) {
      return <circle key={s.label} cx={R} cy={R} r={R} fill={s.color} {...bindHover(s)} />
    }

    const sx = R + R * Math.cos(startAngle)
    const sy = R + R * Math.sin(startAngle)
    const ex = R + R * Math.cos(endAngle)
    const ey = R + R * Math.sin(endAngle)
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
    const d = `M ${R} ${R} L ${sx} ${sy} A ${R} ${R} 0 ${largeArc} 1 ${ex} ${ey} Z`
    return <path key={s.label} d={d} fill={s.color} {...bindHover(s)} />
  })

  return (
    <div
      className={cn(
        'rounded-(--radius) bg-(--color-panel) shadow-(--shadow-xs) p-3 space-y-3',
        className,
      )}
    >
      <div className="text-xs tracking-wider text-(--color-text-dim)">{title}</div>
      <div className="flex items-center gap-4">
        <svg
          viewBox="0 0 100 100"
          className="size-24 shrink-0"
          shapeRendering="geometricPrecision"
          aria-label={title}
        >
          {total > 0 ? (
            slices
          ) : (
            <circle cx={R} cy={R} r={R} fill="var(--color-bg)" />
          )}
          {centerLabel ? (
            <text
              x={50}
              y={50}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-(--color-text) font-mono text-[12px]"
            >
              {centerLabel}
            </text>
          ) : null}
        </svg>

        <ul className="flex-1 min-w-0 space-y-1 text-xs">
          {segments.map(s => {
            const pct = total > 0 ? (s.value / total) * 100 : 0
            return (
              <li key={s.label} className="flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-(--color-text) truncate">{s.label}</span>
                <span className="ml-auto font-mono tabular-nums text-(--color-text-dim)">
                  {pct.toFixed(0)}%
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      {tip &&
        createPortal(
          <div
            className="fixed pointer-events-none z-50 rounded-(--radius) bg-(--color-panel-2) shadow-(--shadow-md) px-2 py-1 text-xs text-(--color-text) whitespace-nowrap"
            style={{ left: tip.x + 12, top: tip.y + 12 }}
          >
            <span className="text-(--color-text-dim)">{tip.label}: </span>
            <span className="font-mono tabular-nums">{tip.value}</span>
          </div>,
          document.body,
        )}
    </div>
  )
}
