import { Fragment, memo } from 'react'
import { Link } from 'react-router-dom'
import { formatDisplayDate } from '@/lib/tz'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from 'lucide-react'
import { DEFAULT_MODEL_NAME, type Model, type TradeRecord } from '@/db/types'
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
  /** Resolved model lookup. Lifted to the parent route so rows render with
   *  the full model record (name + rule groups) on first paint, without
   *  each row opening its own `db.models.get` subscription. */
  modelById: Map<string, Model>
  /** Show the trade date as its own column (between row number and session).
   *  Used on Overview where trades span multiple days; off on the Day page
   *  where every row shares the same date. */
  showDate?: boolean
}

export const TradeTable = memo(function TradeTable({
  trades,
  expandedIds,
  onToggle,
  modelById,
  showDate = false,
}: TradeTableProps) {
  const cols = showDate ? 13 : 12
  return (
    <div className="bg-(--color-panel) rounded-(--radius) overflow-hidden">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {trades.map((t, i) => {
            const expanded = expandedIds.has(t.id)
            const prev = i > 0 ? trades[i - 1] : null
            const reversed = prev ? isReversal(prev, t) : false
            const model = t.model_id ? modelById.get(t.model_id) ?? null : null
            return (
              <Fragment key={t.id}>
                <TradeTableRow
                  trade={t}
                  index={i + 1}
                  expanded={expanded}
                  reversedFromPrev={reversed}
                  onToggle={() => onToggle(t.id)}
                  modelName={model?.name ?? null}
                  showDate={showDate}
                />
                <tr>
                  <td colSpan={cols} className="p-0 bg-(--color-cal-weekend-bg)">
                    <div
                      className={cn(
                        'grid transition-[grid-template-rows] duration-300 ease-out',
                        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                      )}
                    >
                      <div className="overflow-hidden">
                        <div className="p-3">
                          <TradeExpandedDetails trade={t} model={model} />
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
  showDate: boolean
}
function TradeTableRow({
  trade,
  index,
  expanded,
  reversedFromPrev,
  onToggle,
  modelName,
  showDate,
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
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      title={trade.idea}
      className={cn(
        'cursor-pointer transition-colors duration-300 ease-out border-t border-(--color-bg) [&>td]:align-middle [&>td]:pt-[7px] [&>td]:pb-[9px] focus:outline-none focus-visible:bg-(--color-panel-2)/40',
        expanded ? 'bg-(--color-panel-2)/60' : 'hover:bg-(--color-panel-2)/60',
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
      <td className="pl-3 pr-7 py-2 font-mono whitespace-nowrap w-px">
        {trade.symbol_spec.name}
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
      <td className="pl-0 pr-9 py-2 text-xs text-(--color-text-dim) truncate max-w-28 w-px whitespace-nowrap">
        {trade.emotion}
      </td>
      <td className="pl-0 pr-9 py-2 max-w-[18rem]">
        {trade.setup_tags && trade.setup_tags.length > 0 ? (
          <div className="inline-flex flex-wrap items-center gap-1 align-middle">
            {trade.setup_tags.map(t => (
              <span
                key={t}
                className={cn(
                  SESSION_BADGE_CLASS,
                  'bg-(--color-panel-3) text-(--color-text-dim) pb-0.5 px-2',
                )}
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
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
            <span className="-translate-y-px">@ {trade.executions[0]?.price != null ? trade.executions[0].price.toFixed(2) : ''}</span>
          </span>
        )}
        <RatingStars rating={trade.rating} className="translate-y-0.5" />
      </td>
      {showDate && (
        <td className="pl-3 pr-3 py-2 text-xs font-mono text-(--color-text-dim) w-px whitespace-nowrap">
          <Link
            to={`/day/${trade.date}`}
            onClick={e => e.stopPropagation()}
            className="rounded-(--radius) px-1 -mx-1 hover:text-(--color-text) hover:underline focus:outline-none focus-visible:bg-(--color-panel-2)/40"
          >
            {formatDisplayDate(trade.date)}
          </Link>
        </td>
      )}
    </tr>
  )
}

