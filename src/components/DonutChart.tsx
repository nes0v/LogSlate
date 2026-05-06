import { memo, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface DonutSegment {
  label: string
  value: number
  /** CSS color or `var(--…)`. */
  color: string
  /** When true, the wedge still draws on the donut but no row appears in
   *  the side legend. Used for buckets like "(unset)" / "(deleted)" that
   *  should affect the proportions but not the labelled list. */
  legendHidden?: boolean
  /** Optional custom node rendered in place of the legend text label.
   *  The string `label` is still used for the hover tooltip. */
  legendNode?: React.ReactNode
}

interface DonutChartProps {
  title: string
  segments: DonutSegment[]
  /** Optional inner label, e.g. "248 trades". Falls back to total count. */
  centerLabel?: string
  className?: string
  /** Legend column count. Defaults to 1 (vertical list). Set to 2 when the
   *  segment count is large (≥ 8) so the card doesn't grow unusually tall. */
  legendColumns?: 1 | 2
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

function DonutChartImpl({ title, segments, centerLabel, className, legendColumns = 1 }: DonutChartProps) {
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

  // Pie slices as filled SVG wedges. The wedge itself is fill-only; a
  // sibling stroke-only sub-path traces just the outer arc, so anti-
  // aliasing on the curved edge blends slice colour → panel bg cleanly.
  //
  // Each wedge is extended by a small angular epsilon at start and end so
  // that adjacent wedges *overlap* by ~2ε at every seam. Without this,
  // SVG fill-AA on each wedge's radial edges blends with the panel-bg
  // pixel between the two wedges, producing a thin lighter "ladder" line
  // along diagonal seams. Overlapping eliminates the gap entirely; the
  // later-drawn wedge wins along the shared seam (visually invisible
  // since both wedges have full opacity).
  const SEAM_EPSILON = 0.008 // ≈ 0.46°; enough to seal AA gaps without distorting proportions
  let cursor = -Math.PI / 2 // start at 12 o'clock
  const slices = visible.map((s, i) => {
    const fraction = s.value / total
    if (fraction >= 1) {
      return <circle key={s.label} cx={R} cy={R} r={R} fill={s.color} {...bindHover(s)} />
    }
    const baseStart = cursor
    const baseEnd = cursor + fraction * 2 * Math.PI
    cursor = baseEnd
    // Extend on each side except at the very first/last wedge of the ring,
    // since extending past the ring's boundary would just wrap and overlap
    // with itself.
    const startAngle = i > 0 ? baseStart - SEAM_EPSILON : baseStart
    const endAngle = i < visible.length - 1 ? baseEnd + SEAM_EPSILON : baseEnd
    const sx = R + R * Math.cos(startAngle)
    const sy = R + R * Math.sin(startAngle)
    const ex = R + R * Math.cos(endAngle)
    const ey = R + R * Math.sin(endAngle)
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
    const wedge = `M ${R} ${R} L ${sx} ${sy} A ${R} ${R} 0 ${largeArc} 1 ${ex} ${ey} Z`
    const arc = `M ${sx} ${sy} A ${R} ${R} 0 ${largeArc} 1 ${ex} ${ey}`
    return (
      <g key={s.label} {...bindHover(s)}>
        <path d={wedge} fill={s.color} />
        <path d={arc} fill="none" stroke={s.color} strokeWidth={0.5} />
      </g>
    )
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
          viewBox="-1 -1 102 102"
          className="size-28 shrink-0"
          aria-label={title}
          shapeRendering="geometricPrecision"
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

        <ul
          className={cn(
            'flex-1 min-w-0 text-xs',
            legendColumns === 2
              ? 'grid grid-cols-2 gap-x-6 gap-y-1'
              : 'space-y-1',
          )}
        >
          {segments.filter(s => !s.legendHidden).map(s => {
            const pct = total > 0 ? (s.value / total) * 100 : 0
            return (
              <li key={s.label} className="flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-(--color-text) truncate">
                  {s.legendNode ?? s.label}
                </span>
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

// Memoized so the 6 donuts inside a memoized `DistributionDonuts`
// don't unmount/remount when sibling segments change. Default shallow
// compare on props is enough — `segments` arrays are derived from
// memoized parent state, so reference stability already holds.
export const DonutChart = memo(DonutChartImpl)
