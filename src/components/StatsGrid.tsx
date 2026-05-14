import type { AggregateStats } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { formatDuration } from '@/lib/duration'
import { cn } from '@/lib/utils'

interface StatsGridProps {
  stats: AggregateStats
}

export function StatsGrid({ stats }: StatsGridProps) {
  const s = stats
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat
        label="PnL"
        value={formatUsd(s.net_pnl)}
        tone={s.net_pnl > 0 ? 'win' : s.net_pnl < 0 ? 'loss' : 'neutral'}
        sub={`gross ${formatUsd(s.gross_pnl)} / fees ${formatUsd(-s.fees)}`}
        big
      />
      <Stat
        label="Avg risk"
        value={s.avg_risk === null ? '—' : formatUsd(s.avg_risk)}
      />
      <Stat
        label="Avg RR"
        value={s.avg_realized_rr === null ? '—' : `${s.avg_realized_rr.toFixed(2)}x`}
        sub={`planned ${s.avg_planned_rr === null ? '—' : `${s.avg_planned_rr.toFixed(2)}x`}`}
        tone={
          s.avg_realized_rr === null
            ? 'neutral'
            : s.avg_realized_rr > 0
              ? 'win'
              : s.avg_realized_rr < 0
                ? 'loss'
                : 'neutral'
        }
      />
      <Stat
        label="Avg duration"
        value={formatDuration(s.avg_duration_ms)}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  big,
}: {
  label: React.ReactNode
  value: string
  sub?: string
  tone?: 'win' | 'loss' | 'neutral'
  big?: boolean
}) {
  return (
    <div className="bg-(--color-panel) rounded-(--radius) p-3">
      <div className="text-xs text-(--color-text-dim) uppercase tracking-wider">{label}</div>
      <div
        className={cn(
          'font-mono mt-1',
          big ? 'text-xl' : 'text-base',
          tone === 'win' && 'text-(--color-win)',
          tone === 'loss' && 'text-(--color-loss)',
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-(--color-text-dim) mt-0.5 font-mono">{sub}</div>}
    </div>
  )
}
