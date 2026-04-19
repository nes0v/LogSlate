import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Trash2, ArrowDown, ArrowUp } from 'lucide-react'
import type { TradeRecord } from '@/db/types'
import {
  computeRealizedRr,
  effectivePnl,
  inferSide,
  totalContracts,
} from '@/lib/trade-math'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

const RATING_EMOJI: Record<TradeRecord['rating'], string> = {
  good: '👍',
  excellent: '🔥',
  meh: '🥚',
}

const SESSION_BADGE: Record<TradeRecord['session'], string> = {
  pre: 'bg-violet-200 text-violet-950',
  AM: 'bg-sky-300 text-sky-950',
  LT: 'bg-amber-400 text-amber-950',
  PM: 'bg-blue-600 text-blue-50',
  aft: 'bg-purple-800 text-purple-100',
}

interface TradeRowProps {
  trade: TradeRecord
  index?: number // 1-based sequence shown at the start of the row
  onDelete: (id: string) => void
}

function earliestTime(t: TradeRecord): string | null {
  const all = t.executions.map(e => Date.parse(e.time)).filter(n => !Number.isNaN(n))
  if (all.length === 0) return null
  return new Date(Math.min(...all)).toISOString()
}

export function TradeRow({ trade, index, onDelete }: TradeRowProps) {
  const side = inferSide(trade)
  const pnl = effectivePnl(trade)
  const realRr = computeRealizedRr(trade)
  const contracts = totalContracts(trade)
  const start = earliestTime(trade)
  const startHHmm = start ? format(parseISO(start), 'HH:mm') : '—'

  return (
    <div className="grid grid-cols-[auto_auto_auto_auto_auto_1fr_auto_auto_auto] gap-3 items-center bg-(--color-panel) border border-(--color-border) rounded-md px-3 py-2 hover:bg-(--color-panel-2) transition-colors">
      <span className="text-xs font-mono text-(--color-text-dim) w-6 text-right tabular-nums">
        {index !== undefined ? `#${index}` : ''}
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-sm font-mono',
          SESSION_BADGE[trade.session],
        )}
      >
        {trade.session}
      </span>
      <button
        type="button"
        onClick={() => {
          if (confirm('Delete this trade?')) onDelete(trade.id)
        }}
        aria-label="Delete trade"
        className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)"
      >
        <Trash2 className="size-3.5" />
      </button>
      <Link to={`/trade/${trade.id}/edit`} className="contents">
        <span className="text-sm font-mono">
          {trade.symbol}
          <span className="text-xs text-(--color-text-dim)">·{trade.contract_type}</span>
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-0.5 text-sm font-mono',
            side === 'long' && 'text-(--color-win)',
            side === 'short' && 'text-(--color-loss)',
            !side && 'text-(--color-text-dim)',
          )}
        >
          {side === 'long' ? <ArrowUp className="size-3.5" /> : side === 'short' ? <ArrowDown className="size-3.5" /> : null}
          {side === 'long' ? 'buy' : side === 'short' ? 'sell' : '—'} · {contracts}
        </span>
        <span className="text-xs text-(--color-text-dim) truncate">
          <span className="font-mono mr-2">{startHHmm}</span>
          {trade.idea}
        </span>
        <span className="text-xs font-mono text-(--color-text-dim)">
          {trade.planned_rr}x → {realRr === null ? '—' : `${realRr.toFixed(2)}x`}
        </span>
        <span
          className={cn(
            'text-sm font-mono font-medium text-right w-20',
            pnl !== null && pnl > 0 && 'text-(--color-win)',
            pnl !== null && pnl < 0 && 'text-(--color-loss)',
            (pnl === null || pnl === 0) && 'text-(--color-text-dim)',
          )}
        >
          {pnl === null ? '—' : formatUsd(pnl)}
        </span>
        <span aria-hidden className="text-lg">{RATING_EMOJI[trade.rating]}</span>
      </Link>
    </div>
  )
}
