import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import type { Bucket } from '@/lib/buckets'
import { aggregate } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { SessionTags } from '@/components/SessionTags'
import { cn } from '@/lib/utils'

interface WeeklyCardsProps {
  buckets: Bucket[]
}

export function WeeklyCards({ buckets }: WeeklyCardsProps) {
  const weeks = buckets.filter(b => b.trades.length > 0)
  if (weeks.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        Weeks <span className="text-(--color-text-dim) font-normal">({weeks.length})</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {weeks.map(b => {
          const s = aggregate(b.trades)
          const ws = new Date(b.rangeStart + 'T00:00:00')
          const we = new Date(b.rangeEnd + 'T00:00:00')
          const range = `${format(ws, 'MMM d')} – ${format(we, 'MMM d')}`

          return (
            <Link
              key={b.key}
              to={b.navTarget}
              className="bg-(--color-panel) border border-(--color-border) rounded-md p-3 hover:bg-(--color-panel-2) transition-colors block"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-(--color-text-dim) uppercase tracking-wider">
                  {range}
                </span>
                <span
                  className={cn(
                    'font-mono text-base',
                    s.net_pnl > 0 && 'text-(--color-win)',
                    s.net_pnl < 0 && 'text-(--color-loss)',
                    s.net_pnl === 0 && 'text-(--color-text-dim)',
                  )}
                >
                  {formatUsd(s.net_pnl)}
                </span>
              </div>
              <div className="mt-2 space-y-0.5 text-xs font-mono text-(--color-text-dim)">
                <div>
                  {s.count} trade{s.count === 1 ? '' : 's'}
                </div>
                <div>fees {formatUsd(-s.fees)}</div>
                <div>
                  {s.win_rate === null ? '— win' : `${Math.round(s.win_rate * 100)}% win`}
                </div>
                <div>{s.wins}W / {s.losses}L</div>
              </div>
              <div className="mt-4">
                <SessionTags trades={b.trades} />
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
