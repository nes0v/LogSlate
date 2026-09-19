import { IMPACT_COLORS, type FFImpact } from '@/lib/forex-factory'
import { cn } from '@/lib/utils'

/** The colored dot that marks a news event's market impact. Shared by the
 *  Calendar news panel and the Day page so both read one color map.
 *
 *  `className` exists only because the two call sites disagree by a hair:
 *  the Day page renders it `block`, the panel leaves it inline, which shifts
 *  the dot a pixel or two inside an `align-middle` cell. Kept as-is rather
 *  than unified, since neither page asked to move. */
export function ImpactDot({
  impact,
  className,
}: {
  impact: FFImpact
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 10 10"
      className={cn('size-3', className)}
      aria-label={`${impact} impact`}
      role="img"
    >
      <circle cx="5" cy="5" r="4.5" fill={IMPACT_COLORS[impact]} />
    </svg>
  )
}
