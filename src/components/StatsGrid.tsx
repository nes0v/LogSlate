import type { AggregateStats } from '@/lib/trade-stats'
import { formatUsd } from '@/lib/money'
import { formatDuration } from '@/lib/duration'
import { cn } from '@/lib/utils'

interface StatsGridProps {
  stats: AggregateStats
  /**
   * Fractional return on the period (e.g. 0.05 = 5%). Omit to hide the tile;
   * pass null to show a placeholder when a baseline isn't available.
   */
  roi?: number | null
}

export function StatsGrid({ stats, roi }: StatsGridProps) {
  const s = stats
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat
        label="Net PnL"
        value={formatUsd(s.net_pnl)}
        tone={s.net_pnl > 0 ? 'win' : s.net_pnl < 0 ? 'loss' : 'neutral'}
        big
      />
      <Stat label="Trades" value={String(s.count)} />
      <Stat
        label="Win rate"
        value={s.win_rate === null ? '—' : `${Math.round(s.win_rate * 100)}%`}
        sub={`${s.wins}W / ${s.losses}L${s.breakevens ? ` / ${s.breakevens}B` : ''}`}
      />
      <Stat
        label="Gross / fees"
        value={formatUsd(s.gross_pnl)}
        sub={`fees ${formatUsd(-s.fees)}`}
      />
      <Stat
        label="Best"
        value={s.best === null ? '—' : formatUsd(s.best)}
        tone={s.best !== null && s.best > 0 ? 'win' : 'neutral'}
      />
      <Stat
        label="Worst"
        value={s.worst === null ? '—' : formatUsd(s.worst)}
        tone={s.worst !== null && s.worst < 0 ? 'loss' : 'neutral'}
      />
      <Stat
        label="Avg planned R"
        value={s.avg_planned_rr === null ? '—' : `${s.avg_planned_rr.toFixed(2)}x`}
      />
      <Stat
        label="Avg realized R"
        value={s.avg_realized_rr === null ? '—' : `${s.avg_realized_rr.toFixed(2)}x`}
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
        label="Avg win"
        value={s.avg_win === null ? '—' : formatUsd(s.avg_win)}
        tone={s.avg_win !== null && s.avg_win > 0 ? 'win' : 'neutral'}
      />
      <Stat
        label="Avg loss"
        value={s.avg_loss === null ? '—' : formatUsd(s.avg_loss)}
        tone={s.avg_loss !== null && s.avg_loss < 0 ? 'loss' : 'neutral'}
      />
      <Stat
        label="Avg duration"
        value={formatDuration(s.avg_duration_ms)}
      />
      {roi !== undefined && (
        <Stat
          label={
            <>
              ROI{' '}
              <span className="normal-case tracking-normal text-[11px] opacity-70">
                (excluding equity adjustments)
              </span>
            </>
          }
          value={roi === null ? '—' : `${(roi * 100).toFixed(2)}%`}
          tone={roi === null ? 'neutral' : roi > 0 ? 'win' : roi < 0 ? 'loss' : 'neutral'}
        />
      )}
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
    <div className="bg-(--color-panel) border border-(--color-border) rounded-md p-3">
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
