import { Link, useLocation } from 'react-router-dom'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import type { Model, TradeRecord } from '@/db/types'
import { deleteTrade } from '@/db/queries'
import { useConfirm } from '@/components/ConfirmDialog'
import { computeOrphanRules } from '@/lib/model-rules'
import { computeAhpc, totalContracts } from '@/lib/trade-math'
import { handleValue } from '@/lib/symbols'
import { formatUsd } from '@/lib/money'
import { BTN_BASE } from '@/components/form/buttonClass'
import { cn } from '@/lib/utils'

interface TradeExpandedDetailsProps {
  trade: TradeRecord
  /** Resolved model record (or null if the trade has no model). Threaded
   *  in from the route so each expanded row doesn't open its own
   *  `db.models.get` subscription. */
  model: Model | null
}

const ACTION_BTN_BASE =
  `${BTN_BASE} border border-(--color-border) text-(--color-text-dim) transition-colors cursor-pointer`
const NEUTRAL_BTN_CLASS = `${ACTION_BTN_BASE} hover:text-(--color-text)`
const DELETE_BTN_CLASS = `${ACTION_BTN_BASE} hover:text-(--color-loss)`

export function TradeExpandedDetails({ trade, model }: TradeExpandedDetailsProps) {
  const confirm = useConfirm()
  const location = useLocation()
  const contracts = totalContracts(trade)
  const ahpc = computeAhpc(trade)
  const hv = handleValue(trade.symbol, trade.contract_type)

  const execs = [...trade.executions].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  )
  const followed = new Set(trade.model_rules_followed ?? [])

  async function handleDelete() {
    if (!(await confirm({ title: 'Delete this trade?' }))) return
    await deleteTrade(trade.id)
  }

  return (
    <div className="flex items-start gap-6">
      {model && (
        <ModelChecklist groups={model.groups} followed={followed} />
      )}
      {(trade.idea || trade.notes) && (
        <div className="w-[310px] shrink-0 min-w-0 space-y-3">
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
        </div>
      )}
      <div className="shrink-0 space-y-4">
        {execs.length > 0 && (
          <div className="grid grid-cols-[auto_auto_auto_auto_auto] gap-x-4 gap-y-0.5 tabular-nums w-fit text-xs font-mono">
            {execs.map(e => (
              <ExecRow
                key={`${e.time}-${e.kind}-${e.price}`}
                time={e.time.slice(11, 19)}
                kind={e.kind}
                orderType={e.order_type}
                price={e.price.toFixed(2)}
                contracts={e.contracts}
              />
            ))}
          </div>
        )}
        <StatColumn
          rows={[
            ['Drawdown', trade.drawdown === null ? '—' : formatUsd(trade.drawdown)],
            ['Buildup', trade.buildup === null ? '—' : formatUsd(trade.buildup)],
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
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <Link
          to={`/trade/${trade.id}/edit`}
          state={{ from: location.pathname + location.search }}
          className={NEUTRAL_BTN_CLASS}
        >
          <Pencil className="size-4" /> Edit
        </Link>
        <button type="button" onClick={handleDelete} className={DELETE_BTN_CLASS}>
          <Trash2 className="size-4" /> Delete
        </button>
      </div>
    </div>
  )
}

function ExecRow({
  time,
  kind,
  orderType,
  price,
  contracts,
}: {
  time: string
  kind: 'buy' | 'sell'
  orderType: 'mkt' | 'lmt'
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
      <span className="text-(--color-text-dim)">{orderType}</span>
      <span>{price}</span>
      <span className="text-(--color-text-dim)">×{contracts}</span>
    </>
  )
}

function ModelChecklist({
  groups,
  followed,
}: {
  groups: Array<{ id: string; name: string; rules: string[] }>
  followed: Set<string>
}) {
  const total = groups.reduce((n, g) => n + g.rules.length, 0)
  // Strings still saved on the trade that the model no longer contains.
  const orphans = computeOrphanRules(groups, followed)
  if (total === 0 && orphans.length === 0) return null
  return (
    <div className="shrink-0 w-[310px] space-y-0.5">
      {groups.flatMap(g =>
        g.rules.map((r, i) => {
          const ok = followed.has(r)
          const Icon = ok ? Check : X
          return (
            <div key={`${g.id}-${i}`} className="flex items-start gap-1.5">
              <Icon
                className={cn(
                  'size-3.5 shrink-0 mt-[3px]',
                  ok ? 'text-(--color-win)' : 'text-(--color-loss)',
                )}
              />
              <span
                className={cn(
                  'text-sm leading-tight',
                  ok ? 'text-(--color-text)' : 'text-(--color-text-dim)',
                )}
              >
                {r}
              </span>
            </div>
          )
        }),
      )}
      {orphans.length > 0 && (
        <>
          <div className="text-xs text-(--color-text-faint) italic pt-1">
            Removed from model
          </div>
          {orphans.map((r, i) => (
            <div key={`orphan-${i}`} className="flex items-start gap-1.5">
              <Check className="size-3.5 shrink-0 mt-[3px] text-(--color-text-faint)" />
              <span className="text-sm leading-tight text-(--color-text-dim)">
                {r}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
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
