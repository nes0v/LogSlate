import type { TradeRecord } from '@/db/types'
import { cn } from '@/lib/utils'
import { TradeRowCells, TRADE_ROW_COLS } from '@/components/TradeRow'
import { TradeExpandedDetails } from '@/components/TradeExpandedDetails'

interface ExpandableTradeRowProps {
  trade: TradeRecord
  index?: number
  expanded: boolean
  onToggle: () => void
}

// Day-page row: a single panel that holds the compact bar (always visible)
// and the expanded body (animated reveal via CSS grid-rows). Clicking the
// bar toggles expansion; the bar's content stays in place — only the body
// grows out beneath it.
export function ExpandableTradeRow({
  trade,
  index,
  expanded,
  onToggle,
}: ExpandableTradeRowProps) {
  return (
    <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        title={trade.idea}
        className={cn(
          'w-full grid items-center px-3 py-2 transition-colors text-left cursor-pointer gap-x-5',
          TRADE_ROW_COLS,
          expanded ? 'bg-(--color-panel-2)' : 'hover:bg-(--color-panel-2)',
        )}
      >
        <TradeRowCells trade={trade} index={index} />
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1">
            <TradeExpandedDetails trade={trade} />
          </div>
        </div>
      </div>
    </div>
  )
}
