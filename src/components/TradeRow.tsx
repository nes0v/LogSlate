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

interface TradeRowProps {
  trade: TradeRecord
  onDelete: (id: string) => void
}

function earliestTime(t: TradeRecord): string | null {
  const all = t.executions.map(e => Date.parse(e.time)).filter(n => !Number.isNaN(n))
  if (all.length === 0) return null
  return new Date(Math.min(...all)).toISOString()
}

export function TradeRow({ trade, onDelete }: TradeRowProps) {
  const side = inferSide(trade)
  const pnl = effectivePnl(trade)
  const realRr = computeRealizedRr(trade)
  const contracts = totalContracts(trade)
  const start = earliestTime(trade)
  const startHHmm = start ? format(parseISO(start), 'HH:mm') : '—'

  return (
    <div className="grid grid-cols-[auto_auto_auto_1fr_auto_auto_auto] gap-3 items-center bg-(--color-panel) border border-(--color-border) rounded-md px-3 py-2 hover:bg-(--color-panel-2) transition-colors">
      <Link to={`/trade/${trade.id}/edit`} className="contents">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-sm bg-(--color-panel-2) text-(--color-text-dim) font-mono">
          {trade.session}
        </span>
        <span className="text-sm font-mono">
          {trade.symbol}
          <span className="text-(--color-text-dim)">·{trade.contract_type === 'micro' ? 'M' : 'm'}</span>
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-0.5 text-xs font-mono',
            side === 'long' && 'text-(--color-win)',
            side === 'short' && 'text-(--color-loss)',
            !side && 'text-(--color-text-dim)',
          )}
        >
          {side === 'long' ? <ArrowUp className="size-3" /> : side === 'short' ? <ArrowDown className="size-3" /> : null}
          {side ?? '—'} · {contracts}
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
      <button
        type="button"
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          if (confirm('Delete this trade?')) onDelete(trade.id)
        }}
        aria-label="Delete trade"
        className="ml-1 p-1 rounded-md text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}
