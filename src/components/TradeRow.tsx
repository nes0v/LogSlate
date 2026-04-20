import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { TradeRecord } from '@/db/types'
import {
  computeRealizedRr,
  effectivePnl,
  inferSide,
  totalContracts,
} from '@/lib/trade-math'
import { formatUsd } from '@/lib/money'
import { SESSION_BADGE, SESSION_BADGE_CLASS } from '@/components/SessionTags'
import { cn } from '@/lib/utils'

const RATING_EMOJI: Record<TradeRecord['rating'], string> = {
  good: '👍',
  excellent: '🔥',
  meh: '🥚',
}

// Shared column template used by TradeList. Each row is a subgrid of these
// same tracks, so columns line up vertically across all rows.
export const TRADE_ROW_COLS =
  'grid-cols-[auto_auto_auto_auto_auto_1fr_auto_auto_auto]'

interface TradeRowProps {
  trade: TradeRecord
  index?: number // 1-based sequence shown at the start of the row
}

function earliestTime(t: TradeRecord): string | null {
  const all = t.executions.map(e => Date.parse(e.time)).filter(n => !Number.isNaN(n))
  if (all.length === 0) return null
  return new Date(Math.min(...all)).toISOString()
}

export function TradeRow({ trade, index }: TradeRowProps) {
  const side = inferSide(trade)
  const pnl = effectivePnl(trade)
  const realRr = computeRealizedRr(trade)
  const contracts = totalContracts(trade)
  const start = earliestTime(trade)
  const startHHmm = start ? format(parseISO(start), 'HH:mm') : '—'

  return (
    <Link
      to={`/trade/${trade.id}/edit`}
      title={trade.idea}
      className="col-span-9 grid grid-cols-subgrid items-center bg-(--color-panel) border border-(--color-border) rounded-md px-3 py-2 hover:bg-(--color-panel-2) transition-colors"
    >
      <span className="text-xs font-mono text-(--color-text-dim) tabular-nums">
        {index !== undefined ? `#${index}` : ''}
      </span>
      <span
        className={cn(
          SESSION_BADGE_CLASS,
          'justify-center',
          SESSION_BADGE[trade.session],
        )}
      >
        {trade.session}
      </span>
      <span className="text-sm font-mono">
        {trade.symbol}
        <span className="text-xs text-(--color-text-dim)">·{trade.contract_type}</span>
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1 text-sm font-mono whitespace-nowrap',
          side === 'long' && 'text-(--color-win)',
          side === 'short' && 'text-(--color-loss)',
          !side && 'text-(--color-text-dim)',
        )}
      >
        {side === 'long' ? (
          <ArrowUp className="size-3.5" />
        ) : side === 'short' ? (
          <ArrowDown className="size-3.5" />
        ) : null}
        {side === 'long' ? 'buy' : side === 'short' ? 'sell' : '—'}
      </span>
      <span className="text-sm font-mono tabular-nums text-(--color-text-dim)">
        ×{contracts}
      </span>
      <span className="text-xs text-(--color-text-dim) truncate flex items-baseline gap-3 min-w-0">
        <span className="font-mono tabular-nums shrink-0">
          {format(new Date(trade.trade_date + 'T00:00:00'), 'MMM dd')} · {startHHmm}
        </span>
        <span className="truncate">{trade.idea}</span>
      </span>
      <span className="text-xs font-mono text-(--color-text-dim) tabular-nums whitespace-nowrap">
        {trade.planned_rr}x → {realRr === null ? '—' : `${realRr.toFixed(2)}x`}
      </span>
      <span
        className={cn(
          'text-sm font-mono font-medium tabular-nums whitespace-nowrap',
          pnl !== null && pnl > 0 && 'text-(--color-win)',
          pnl !== null && pnl < 0 && 'text-(--color-loss)',
          (pnl === null || pnl === 0) && 'text-(--color-text-dim)',
        )}
      >
        {pnl === null ? '—' : formatUsd(pnl)}
      </span>
      <span aria-hidden className="text-lg leading-none">{RATING_EMOJI[trade.rating]}</span>
    </Link>
  )
}
