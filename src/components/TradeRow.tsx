import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { DEFAULT_MODEL_NAME, type TradeRecord } from '@/db/types'
import { db } from '@/db/schema'
import {
  computeDuration,
  computePlannedRr,
  inferSide,
  outcomeTextClass,
  totalContracts,
  tradeMetrics,
} from '@/lib/trade-math'
import { formatDuration } from '@/lib/duration'
import { formatUsd } from '@/lib/money'
import { RATING_LABEL } from '@/lib/rating-label'
import { SESSION_BADGE, SESSION_BADGE_CLASS } from '@/lib/session-badge'
import { cn } from '@/lib/utils'

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

// Renders the 9 cells that make up a trade row. Reusable across Link- and
// button-shaped wrappers (Stats vs Day expandable row).
export function TradeRowCells({ trade, index }: TradeRowProps) {
  const side = inferSide(trade)
  const { pnl, outcome } = tradeMetrics(trade)
  const realRr = trade.stop_loss > 0 && pnl !== null ? pnl / trade.stop_loss : null
  const plannedRr = computePlannedRr(trade)
  const contracts = totalContracts(trade)
  const start = earliestTime(trade)
  const startHHmm = start ? format(parseISO(start), 'HH:mm') : '—'
  const dur = computeDuration(trade)
  const tone = outcomeTextClass(outcome, pnl !== null)
  const playbook = useLiveQuery(
    () => (trade.playbook_id ? db.playbooks.get(trade.playbook_id) : undefined),
    [trade.playbook_id],
  )

  return (
    <>
      <span className="text-xs font-mono text-(--color-text-dim) tabular-nums -mr-4 inline-block w-7">
        {index !== undefined ? `#${index}` : ''}
      </span>
      <span
        className={cn(
          SESSION_BADGE_CLASS,
          'justify-center -mr-1.5',
          SESSION_BADGE[trade.session],
        )}
      >
        {trade.session}
      </span>
      <span className="text-sm font-mono -mr-5 inline-block min-w-[4.5rem]">
        {trade.symbol}
        <span className="text-xs text-(--color-text-dim) relative -top-px"> · {trade.contract_type}</span>
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1 text-sm font-mono whitespace-nowrap -mr-[18px]',
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
        <span className="inline-block w-12">
          {side === 'long' ? 'long' : side === 'short' ? 'short' : '—'}
        </span>
      </span>
      <span className="text-sm font-mono tabular-nums text-(--color-text-dim) inline-block min-w-[3ch] -mr-2">
        ×{contracts}
      </span>
      <span className="text-xs text-(--color-text-dim) flex items-baseline gap-3 min-w-0">
        <span className="font-mono tabular-nums shrink-0 inline-block w-24">
          {startHHmm}
          {dur.total_ms !== null && ` (${formatDuration(dur.total_ms)})`}
        </span>
        <span className="inline-block w-20 truncate text-(--color-text)">
          {playbook?.name ?? DEFAULT_MODEL_NAME}
        </span>
        <span className="inline-block w-24 truncate">
          {trade.emotion ?? ''}
        </span>
      </span>
      <span className="text-xs font-mono text-(--color-text-dim) tabular-nums whitespace-nowrap inline-block w-[4.5rem] text-left -mr-5">
        {plannedRr === null ? '—' : `${plannedRr.toFixed(2)}x`} → {realRr === null ? '—' : `${realRr.toFixed(2)}x`}
      </span>
      <span
        className={cn(
          'text-sm font-mono font-medium tabular-nums whitespace-nowrap inline-block w-24 text-right',
          tone,
        )}
      >
        {pnl === null ? '—' : formatUsd(pnl)}
      </span>
      <span className={cn('text-sm font-mono inline-block w-10 text-center', tone)}>
        {RATING_LABEL[trade.rating]}
      </span>
    </>
  )
}

export function TradeRow({ trade, index }: TradeRowProps) {
  return (
    <Link
      to={`/trade/${trade.id}/edit`}
      title={trade.idea}
      className="col-span-9 grid grid-cols-subgrid items-center bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) px-3 py-2 hover:bg-(--color-panel-2) transition-colors"
    >
      <TradeRowCells trade={trade} index={index} />
    </Link>
  )
}
