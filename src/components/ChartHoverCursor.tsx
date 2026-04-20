import { CartesianGrid } from 'recharts'

interface ChartHoverCursorProps {
  /** Hovered x-axis category (YYYY-MM-DD bucket key), or null when not hovering. */
  hoverLabel: string | null
}

/**
 * Dashed vertical cursor rendered inside a Recharts chart. Uses a CartesianGrid
 * (which renders in the background layer) so the cursor sits beneath the bars
 * or line — Recharts' built-in Tooltip cursor is always drawn on top.
 *
 * Must be rendered as a direct child of a chart component (LineChart /
 * ComposedChart) so Recharts recognizes and routes the CartesianGrid.
 */
export function ChartHoverCursor({ hoverLabel }: ChartHoverCursorProps) {
  return (
    <CartesianGrid
      horizontal={false}
      stroke="var(--color-text-dim)"
      strokeDasharray="3 3"
      shapeRendering="crispEdges"
      verticalCoordinatesGenerator={({ xAxis }) => {
        if (hoverLabel === null || !xAxis?.scale) return []
        const x = xAxis.scale.map(hoverLabel, { position: 'middle' })
        return typeof x === 'number' && !Number.isNaN(x) ? [x] : []
      }}
    />
  )
}
