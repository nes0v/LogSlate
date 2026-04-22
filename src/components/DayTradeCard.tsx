import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import type { TradeRecord } from '@/db/types'
import { deleteTrade } from '@/db/queries'
import {
  computeAhpc,
  computeDuration,
  computeRealizedRr,
  effectivePnl,
  inferSide,
  totalContracts,
} from '@/lib/trade-math'
import { driveViewUrlFromRef, parseScreenshotRef } from '@/lib/drive-images'
import { handleValue } from '@/lib/symbols'
import { formatDuration } from '@/lib/duration'
import { formatUsd } from '@/lib/money'
import { RATING_EMOJI } from '@/lib/rating-emoji'
import { SESSION_BADGE, SESSION_BADGE_CLASS } from '@/lib/session-badge'
import { cn } from '@/lib/utils'

interface DayTradeCardProps {
  trade: TradeRecord
  index?: number
}

const ACTION_BTN_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-(--color-border) hover:bg-(--color-panel-2)'

// Rich per-trade card for the Day page: everything in one glance so the user
// doesn't have to open each trade individually.
export function DayTradeCard({ trade, index }: DayTradeCardProps) {
  const side = inferSide(trade)
  const pnl = effectivePnl(trade)
  const realRr = computeRealizedRr(trade)
  const contracts = totalContracts(trade)
  const dur = computeDuration(trade)
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
    <div className="bg-(--color-panel) border border-(--color-border) rounded-md px-4 py-4 space-y-3 min-w-0">
      <div className="flex items-center gap-3 flex-wrap">
        {index !== undefined && (
          <span className="text-xs font-mono text-(--color-text-dim) tabular-nums">
            #{index}
          </span>
        )}
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
          <span className="text-(--color-text-dim)"> ×{contracts}</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              'text-base font-mono font-medium tabular-nums whitespace-nowrap',
              pnl !== null && pnl > 0 && 'text-(--color-win)',
              pnl !== null && pnl < 0 && 'text-(--color-loss)',
              (pnl === null || pnl === 0) && 'text-(--color-text-dim)',
            )}
          >
            {pnl === null ? '—' : formatUsd(pnl)}
          </span>
          <span aria-hidden className="text-lg leading-none">
            {RATING_EMOJI[trade.rating]}
          </span>
        </span>
      </div>

      {trade.idea && (
        <p className="text-sm text-(--color-text) whitespace-pre-wrap break-words">
          {trade.idea}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[auto_auto] gap-x-20 gap-y-3 sm:gap-y-5 pt-2 w-fit">
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
            ['Drawdown', formatUsd(trade.drawdown)],
            [
              'Buildup',
              trade.buildup === null ? '—' : formatUsd(trade.buildup),
            ],
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
        <StatColumn
          rows={[
            ['Duration', formatDuration(dur.total_ms)],
            [
              'RR',
              `${trade.planned_rr}x → ${realRr === null ? '—' : `${realRr.toFixed(2)}x`}`,
            ],
          ]}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Link
          to={`/trade/${trade.id}/edit`}
          className={cn(ACTION_BTN_CLASS, 'text-(--color-accent)')}
        >
          <Pencil className="size-3.5" /> Edit
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          className={cn(ACTION_BTN_CLASS, 'text-(--color-loss)')}
        >
          <Trash2 className="size-3.5" /> Delete
        </button>
        {driveUrl && (
          <a
            href={driveUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(ACTION_BTN_CLASS, 'text-(--color-accent)')}
          >
            <ExternalLink className="size-3.5" /> Drive
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
