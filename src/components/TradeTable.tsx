import { Fragment, memo } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from 'lucide-react'
import { DEFAULT_MODEL_NAME, type TradeRecord } from '@/db/types'
import {
  computeDuration,
  computePlannedRr,
  inferSide,
  isReversal,
  outcomeTextClass,
  totalContracts,
  tradeMetrics,
} from '@/lib/trade-math'
import { formatDuration } from '@/lib/duration'
import { formatUsd } from '@/lib/money'
import { RatingStars } from '@/components/RatingStars'
import { SESSION_BADGE, SESSION_BADGE_CLASS } from '@/lib/session-badge'
import { cn } from '@/lib/utils'
import { TradeExpandedDetails } from '@/components/TradeExpandedDetails'

interface TradeTableProps {
  trades: TradeRecord[]
  expandedIds: Set<string>
  onToggle: (id: string) => void
  /** Resolved model name lookup. Lifted to the parent route so the page
   *  reveals with full model names already filled in — without this,
   *  rows briefly showed "gambling" before the model query resolved. */
  modelNameById: Map<string, string>
}

const COLS = 12

export const TradeTable = memo(function TradeTable({
  trades,
  expandedIds,
  onToggle,
  modelNameById,
}: TradeTableProps) {
  return (
    <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) overflow-hidden">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {trades.map((t, i) => {
            const expanded = expandedIds.has(t.id)
            const prev = i > 0 ? trades[i - 1] : null
            const reversed = prev ? isReversal(prev, t) : false
            return (
              <Fragment key={t.id}>
                <TradeTableRow
                  trade={t}
                  index={i + 1}
                  expanded={expanded}
                  reversedFromPrev={reversed}
                  onToggle={() => onToggle(t.id)}
                  modelName={
                    t.model_id ? modelNameById.get(t.model_id) ?? null : null
                  }
                />
                <tr>
                  <td colSpan={COLS} className="p-0 bg-(--color-panel-2)/40">
                    <div
                      className={cn(
                        'grid transition-[grid-template-rows] duration-300 ease-out',
                        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                      )}
                    >
                      <div className="overflow-hidden">
                        <div className="p-3">
                          <TradeExpandedDetails trade={t} />
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})

interface RowProps {
  trade: TradeRecord
  index: number
  expanded: boolean
  /** True when the previous trade reversed into this one — renders a small
   *  "@ price" label floating above the top edge of this row. */
  reversedFromPrev: boolean
  onToggle: () => void
  /** Resolved model name (if the trade has one) — passed in so each row
   *  doesn't open its own `db.models.get` subscription. */
  modelName: string | null
}
function TradeTableRow({
  trade,
  index,
  expanded,
  reversedFromPrev,
  onToggle,
  modelName,
}: RowProps) {
  const side = inferSide(trade)
  const { pnl, outcome } = tradeMetrics(trade)
  const realRr = trade.stop_loss > 0 && pnl !== null ? pnl / trade.stop_loss : null
  const plannedRr = computePlannedRr(trade)
  const contracts = totalContracts(trade)
  const dur = computeDuration(trade)
  const tone = outcomeTextClass(outcome, pnl !== null)

  return (
    <tr
      onClick={onToggle}
      title={trade.idea}
      className={cn(
        'cursor-pointer transition-colors duration-300 ease-out border-t border-(--color-bg) [&>td]:align-middle [&>td]:pt-[7px] [&>td]:pb-[9px]',
        expanded ? 'bg-(--color-panel-2)' : 'hover:bg-(--color-panel-2)/60',
      )}
    >
      <td className="pl-3 pr-4 py-2 text-xs font-mono tabular-nums text-(--color-text-dim) w-px whitespace-nowrap">
        #{index}
      </td>
      <td className="pl-0 pr-0 py-2 w-px">
        <span className={cn(SESSION_BADGE_CLASS, SESSION_BADGE[trade.session])}>
          {trade.session}
        </span>
      </td>
      <td className="pl-3 pr-3 py-2 font-mono whitespace-nowrap w-px">
        {trade.symbol}
      </td>
      <td className="pl-0 pr-7 py-2 text-xs font-mono text-(--color-text-dim) whitespace-nowrap w-px">
        {trade.contract_type}
      </td>
      <td className="pl-0 pr-3 py-2 w-px">
        <span
          className={cn(
            'inline-flex items-center gap-1 font-mono whitespace-nowrap',
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
          {side ?? '—'}
        </span>
      </td>
      <td className="pl-0 pr-7 py-2 font-mono tabular-nums text-(--color-text-dim) w-px whitespace-nowrap">
        ×{contracts}
      </td>
      <td className="pl-0 pr-9 py-2 text-xs font-mono tabular-nums text-(--color-text-dim) whitespace-nowrap w-px">
        {dur.total_ms !== null ? formatDuration(dur.total_ms) : '—'}
      </td>
      <td className={cn('pl-0 pr-9 py-2 text-xs truncate max-w-32 w-px', !trade.model_id && 'text-amber-600')}>
        {modelName ?? DEFAULT_MODEL_NAME}
      </td>
      <td className="pl-0 pr-2 py-2 text-xs text-(--color-text-dim) truncate max-w-28">
        {trade.emotion ?? ''}
      </td>
      <td className="pl-0 pr-9 py-2 text-xs font-mono tabular-nums text-(--color-text-dim) whitespace-nowrap w-px">
        <span className="inline-flex items-center justify-end gap-1">
          <span>{plannedRr === null ? '—' : `${plannedRr.toFixed(2)}x`}</span>
          <ArrowRight className="size-3 opacity-70" />
          <span>{realRr === null ? '—' : `${realRr.toFixed(2)}x`}</span>
        </span>
      </td>
      <td
        className={cn(
          'pl-0 pr-6 py-2 font-mono font-medium tabular-nums whitespace-nowrap text-right w-px',
          tone,
        )}
      >
        {pnl === null ? '—' : formatUsd(pnl)}
      </td>
      <td className="pl-0 pr-3 py-2 font-mono text-center w-px relative">
        {reversedFromPrev && (
          <span
            className="absolute right-[16.5rem] -top-[11px] inline-flex items-center gap-1 w-[6.25rem] text-xs leading-none text-(--color-text-dim) bg-(--color-bg) rounded-(--radius) px-2 py-[4.5px] whitespace-nowrap z-10 pointer-events-none"
          >
            <ArrowUpDown className="size-3" />
            <span className="-translate-y-px">@ {trade.executions[0]?.price ?? ''}</span>
          </span>
        )}
        <RatingStars rating={trade.rating} className="translate-y-0.5" />
      </td>
    </tr>
  )
}

