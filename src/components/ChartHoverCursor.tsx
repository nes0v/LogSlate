import { CartesianGrid } from 'recharts'
import { useHoverLabel } from '@/lib/hover-cursor'

/**
 * Dashed vertical cursor rendered inside a Recharts chart. Uses a CartesianGrid
 * (which renders in the background layer) so the cursor sits beneath the bars
 * or line — Recharts' built-in Tooltip cursor is always drawn on top.
 *
 * Must be rendered as a direct child of a chart component (LineChart /
 * ComposedChart) so Recharts recognizes and routes the CartesianGrid. Reads
 * the current hover label from a module-level store; the chart itself doesn't
 * have to pass it down as a prop, which means hover moves don't trigger
 * parent-tree re-renders.
 */
export function ChartHoverCursor() {
  const hoverLabel = useHoverLabel()
  return (
    <CartesianGrid
      horizontal={false}
      stroke="var(--color-text-dim)"
      strokeDasharray="1 3"
      shapeRendering="crispEdges"
      verticalCoordinatesGenerator={({ xAxis }) => {
        if (hoverLabel === null || !xAxis?.scale) return []
        const x = xAxis.scale.map(hoverLabel, { position: 'middle' })
        return typeof x === 'number' && !Number.isNaN(x) ? [x] : []
      }}
    />
  )
}
