import { Link } from 'react-router-dom'
import type { Bucket } from '@/lib/buckets'
import { aggregate } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

interface PeriodBreakdownProps {
  title: string
  buckets: Bucket[]
}

export function PeriodBreakdown({ title, buckets }: PeriodBreakdownProps) {
  return (
    <section className="bg-(--color-panel) border border-(--color-border) rounded-md">
      <header className="flex items-center justify-between px-3 py-2 border-b border-(--color-border)">
        <h2 className="text-sm font-medium">{title}</h2>
      </header>
      <div className="divide-y divide-(--color-border)">
        {buckets.map(b => {
          const s = aggregate(b.trades)
          return (
            <Link
              key={b.key}
              to={b.navTarget}
              className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-3 py-2 hover:bg-(--color-panel-2) transition-colors"
            >
              <span className="text-sm">{b.label}</span>
              <span className="text-xs text-(--color-text-dim) font-mono">
                {s.count === 0 ? '—' : `${s.count} trade${s.count === 1 ? '' : 's'}`}
              </span>
              <span className="text-xs text-(--color-text-dim) font-mono">
                {s.win_rate === null ? '—' : `${Math.round(s.win_rate * 100)}%`}
              </span>
              <span className="text-xs text-(--color-text-dim) font-mono w-20 text-right">
                {s.count === 0 ? '—' : `${s.wins}W / ${s.losses}L`}
              </span>
              <span
                className={cn(
                  'text-sm font-mono font-medium w-24 text-right',
                  s.net_pnl > 0 && 'text-(--color-win)',
                  s.net_pnl < 0 && 'text-(--color-loss)',
                  s.net_pnl === 0 && 'text-(--color-text-dim)',
                )}
              >
                {s.count === 0 ? '—' : formatUsd(s.net_pnl)}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
