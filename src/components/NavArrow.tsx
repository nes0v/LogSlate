import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavArrowProps {
  to: string | null
  direction: 'prev' | 'next'
  label: string
}

// Small ghost-style chevron that either links to `to` or renders disabled.
// Shared between the Day and Trade edit headers so prev/next look the same
// everywhere.
export function NavArrow({ to, direction, label }: NavArrowProps) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  const classes =
    'p-1 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)'
  if (!to) {
    return (
      <span aria-disabled className={cn(classes, 'opacity-30 pointer-events-none')}>
        <Icon className="size-4" />
      </span>
    )
  }
  return (
    <Link to={to} aria-label={label} title={label} className={classes}>
      <Icon className="size-4" />
    </Link>
  )
}
