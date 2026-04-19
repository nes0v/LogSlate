import type { TradeRecord } from '@/db/types'
import { aggregate } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

interface FacetItem {
  label: string
  trades: TradeRecord[]
}

interface FacetBreakdownProps {
  title: string
  items: FacetItem[]
}

export function FacetBreakdown({ title, items }: FacetBreakdownProps) {
  return (
    <section className="bg-(--color-panel) border border-(--color-border) rounded-md">
      <header className="px-3 py-2 border-b border-(--color-border)">
        <h2 className="text-sm font-medium">{title}</h2>
      </header>
      <div className="divide-y divide-(--color-border)">
        {items.map(item => {
          const s = aggregate(item.trades)
          return (
            <div
              key={item.label}
              className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-3 py-2"
            >
              <span className="text-sm">{item.label}</span>
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
            </div>
          )
        })}
      </div>
    </section>
  )
}
