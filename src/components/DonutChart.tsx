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
export function DonutChart({ title, segments, centerLabel, className }: DonutChartProps) {
  const total = segments.reduce((n, s) => n + s.value, 0)
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const stroke = 14

  let offset = 0
  const slices = segments
    .filter(s => s.value > 0)
    .map(s => {
      const dash = (s.value / total) * circumference
      const node = (
        <circle
          key={s.label}
          cx={50}
          cy={50}
          r={radius}
          fill="none"
          stroke={s.color}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeDashoffset={-offset}
          // Stroke renders clockwise from 3 o'clock by default — rotate
          // the whole ring so it starts at 12 o'clock.
          transform="rotate(-90 50 50)"
        />
      )
      offset += dash
      return node
    })

  return (
    <div
      className={cn(
        'rounded-(--radius) bg-(--color-panel) shadow-(--shadow-xs) p-3 space-y-3',
        className,
      )}
    >
      <div className="text-xs uppercase tracking-wider text-(--color-text-dim)">{title}</div>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="size-24 shrink-0">
          {/* Track ring so empty / single-segment donuts still read as a
              ring rather than a thick arc. */}
          <circle
            cx={50}
            cy={50}
            r={radius}
            fill="none"
            stroke="var(--color-bg)"
            strokeWidth={stroke}
          />
          {total > 0 && slices}
          <text
            x={50}
            y={50}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-(--color-text) font-mono text-[12px]"
          >
            {centerLabel ?? `${total}`}
          </text>
        </svg>

        <ul className="flex-1 min-w-0 space-y-1 text-xs">
          {segments.map(s => {
            const pct = total > 0 ? (s.value / total) * 100 : 0
            return (
              <li key={s.label} className="flex items-center gap-2">
                <span
                  className="size-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-(--color-text) truncate">{s.label}</span>
                <span className="ml-auto font-mono tabular-nums text-(--color-text-dim)">
                  {s.value} · {pct.toFixed(0)}%
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
