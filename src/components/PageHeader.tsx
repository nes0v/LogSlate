import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// One shared chevron-button style. Using <Link> across every page header
// (rather than a mix of <Link> + <button>) keeps the icon's rendered box the
// same in every browser — inline-flex centers the SVG identically regardless
// of whether the URL is navigable or disabled.
const NAV_BTN_CLASS =
  'inline-flex items-center justify-center p-1.5 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)'

interface PageHeaderProps {
  title: string
  /** URL for the prev arrow. `null` renders the arrow disabled. Omit to hide. */
  prev?: string | null
  /** URL for the next arrow. `null` renders the arrow disabled. Omit to hide. */
  next?: string | null
  prevLabel?: string
  nextLabel?: string
  /** URL for the optional "Today" button rendered after the next arrow. */
  todayTo?: string
  rightSlot?: React.ReactNode
}

export function PageHeader({
  title,
  prev,
  next,
  prevLabel = 'Previous',
  nextLabel = 'Next',
  todayTo,
  rightSlot,
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 h-12">
      <div className="flex items-center gap-2">
        {prev !== undefined && <Arrow to={prev} direction="prev" label={prevLabel} />}
        <h1 className="text-lg font-semibold min-w-56 text-center">{title}</h1>
        {next !== undefined && <Arrow to={next} direction="next" label={nextLabel} />}
        {todayTo && (
          <Link
            to={todayTo}
            className="ml-2 px-2 py-1 text-xs rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
          >
            Today
          </Link>
        )}
      </div>
      {rightSlot}
    </div>
  )
}

function Arrow({
  to,
  direction,
  label,
}: {
  to: string | null
  direction: 'prev' | 'next'
  label: string
}) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  if (!to) {
    return (
      <span aria-disabled className={cn(NAV_BTN_CLASS, 'opacity-30 pointer-events-none')}>
        <Icon className="size-4" />
      </span>
    )
  }
  return (
    <Link to={to} aria-label={label} title={label} className={NAV_BTN_CLASS}>
      <Icon className="size-4" />
    </Link>
  )
}
