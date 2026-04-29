import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import type { TradeRecord } from '@/db/types'
import { deleteTrade } from '@/db/queries'
import { computeAhpc, totalContracts } from '@/lib/trade-math'
import { driveViewUrlFromRef, parseScreenshotRef } from '@/lib/drive-images'
import { handleValue } from '@/lib/symbols'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

interface TradeExpandedDetailsProps {
  trade: TradeRecord
}

const ACTION_BTN_CLASS =
  'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-(--radius) bg-(--color-bg) text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2) transition-colors cursor-pointer'

export function TradeExpandedDetails({ trade }: TradeExpandedDetailsProps) {
  const contracts = totalContracts(trade)
  const ahpc = computeAhpc(trade)
  const hv = handleValue(trade.symbol, trade.contract_type)

  const execs = [...trade.executions].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  )
  const driveUrl = driveViewUrlFromRef(parseScreenshotRef(trade.screenshot))

  async function handleDelete() {
    if (!confirm('Delete this trade?')) return
    await deleteTrade(trade.id)
  }

  return (
    <div className="space-y-3 min-w-0">
      {trade.idea && (
        <p className="text-sm text-(--color-text) whitespace-pre-wrap break-words">
          {trade.idea}
        </p>
      )}
      {trade.notes && (
        <p className="text-sm text-(--color-text-dim) whitespace-pre-wrap break-words">
          {trade.notes}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[auto_auto] gap-x-20 gap-y-3 sm:gap-y-5 w-fit">
        {execs.length > 0 ? (
          <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-4 gap-y-0.5 tabular-nums w-fit text-xs font-mono">
            {execs.map(e => (
              <ExecRow
                key={`${e.time}-${e.kind}-${e.price}`}
                time={format(parseISO(e.time), 'HH:mm')}
                kind={e.kind}
                price={e.price.toFixed(2)}
                contracts={e.contracts}
              />
            ))}
          </div>
        ) : (
          <div />
        )}
        <StatColumn
          rows={[
            ['Drawdown', trade.drawdown === null ? '—' : formatUsd(trade.drawdown)],
            ['Buildup', trade.buildup === null ? '—' : formatUsd(trade.buildup)],
          ]}
        />
        <StatColumn
          rows={[
            [
              'AHPC',
              ahpc === null
                ? '—'
                : `${ahpc.toFixed(2)} (${formatUsd(ahpc * hv)})`,
            ],
            [
              'SL',
              contracts > 0 && hv > 0
                ? `${(trade.stop_loss / (contracts * hv)).toFixed(2)} (${formatUsd(trade.stop_loss)})`
                : formatUsd(trade.stop_loss),
            ],
          ]}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Link to={`/trade/${trade.id}/edit`} className={ACTION_BTN_CLASS}>
          <Pencil className="size-4" /> Edit
        </Link>
        <button type="button" onClick={handleDelete} className={ACTION_BTN_CLASS}>
          <Trash2 className="size-4" /> Delete
        </button>
        {driveUrl && (
          <a
            href={driveUrl}
            target="_blank"
            rel="noreferrer"
            className={ACTION_BTN_CLASS}
          >
            <ExternalLink className="size-4" /> Drive
          </a>
        )}
      </div>
    </div>
  )
}

function ExecRow({
  time,
  kind,
  price,
  contracts,
}: {
  time: string
  kind: 'buy' | 'sell'
  price: string
  contracts: number
}) {
  return (
    <>
      <span className="text-(--color-text-dim)">{time}</span>
      <span
        className={cn(
          kind === 'buy' ? 'text-(--color-win)' : 'text-(--color-loss)',
        )}
      >
        {kind}
      </span>
      <span>{price}</span>
      <span className="text-(--color-text-dim)">×{contracts}</span>
    </>
  )
}

function StatColumn({ rows }: { rows: Array<[label: string, value: string]> }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs font-mono tabular-nums">
      {rows.flatMap(([label, value]) => [
        <span key={`${label}-l`} className="text-(--color-text-dim)">
          {label}
        </span>,
        <span key={`${label}-v`} className="text-(--color-text)">
          {value}
        </span>,
      ])}
    </div>
  )
}
