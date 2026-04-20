import { Link } from 'react-router-dom'
import type { Bucket } from '@/lib/buckets'
import { aggregate } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { SessionTags } from '@/components/SessionTags'
import { cn } from '@/lib/utils'

interface PeriodBreakdownProps {
  title: string
  buckets: Bucket[]
}

export function PeriodBreakdown({ title, buckets }: PeriodBreakdownProps) {
  const active = buckets.filter(b => b.trades.length > 0)
  if (active.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        {title} <span className="text-(--color-text-dim) font-normal">({active.length})</span>
      </h2>
      <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto_auto] gap-x-5 gap-y-1.5">
        {active.map((b, i) => {
          const s = aggregate(b.trades)
          return (
            <Link
              key={b.key}
              to={b.navTarget}
              className="col-span-8 grid grid-cols-subgrid items-center bg-(--color-panel) border border-(--color-border) rounded-md px-3 py-2 hover:bg-(--color-panel-2) transition-colors"
            >
              <span className="text-xs font-mono text-(--color-text-dim) tabular-nums">
                #{i + 1}
              </span>
              <span className="text-sm">{b.label}</span>
              <SessionTags trades={b.trades} />
              <span className="text-xs text-(--color-text-dim) font-mono whitespace-nowrap">
                {s.count === 0 ? '—' : `${s.count} trade${s.count === 1 ? '' : 's'}`}
              </span>
              <span className="text-xs text-(--color-text-dim) font-mono tabular-nums whitespace-nowrap">
                {s.count === 0 ? '—' : `fees ${formatUsd(-s.fees)}`}
              </span>
              <span className="text-xs text-(--color-text-dim) font-mono tabular-nums whitespace-nowrap">
                {s.win_rate === null ? '—' : `${Math.round(s.win_rate * 100)}% win`}
              </span>
              <span className="text-xs text-(--color-text-dim) font-mono tabular-nums whitespace-nowrap">
                {s.count === 0 ? '—' : `${s.wins}W / ${s.losses}L`}
              </span>
              <span
                className={cn(
                  'text-sm font-mono font-medium tabular-nums whitespace-nowrap',
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
