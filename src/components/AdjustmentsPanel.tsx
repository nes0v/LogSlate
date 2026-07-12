import { useState } from 'react'
import type { EquityAdjustment } from '@/db/types'
import { BrokerFeesPanel } from '@/components/BrokerFeesPanel'
import { EquityAdjustmentsPanel } from '@/components/EquityAdjustmentsPanel'
import { cn } from '@/lib/utils'

type Tab = 'cash' | 'fees'

interface AdjustmentsPanelProps {
  adjustments: EquityAdjustment[]
}

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'cash', label: 'Deposits & withdrawals' },
  { value: 'fees', label: 'Monthly fees' },
]

export function AdjustmentsPanel({ adjustments }: AdjustmentsPanelProps) {
  const [tab, setTab] = useState<Tab>('cash')
  return (
    <section>
      {/* Browser-tab pattern: title sits outside the card; the tab row is
          absolute-positioned with its bottom flush against the panel's top
          edge so the active tab visually merges into the panel. */}
      <div className="relative mb-2">
        <h2 className="text-sm font-medium">Adjustments</h2>
        <div className="absolute right-0 -bottom-2">
          <div role="tablist" className="flex gap-1 text-sm">
            {TABS.map(opt => {
              const active = opt.value === tab
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(opt.value)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-t-(--radius) transition-colors whitespace-nowrap',
                    active
                      ? 'text-(--color-text) bg-(--color-panel)'
                      : 'text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel)/60',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="bg-(--color-panel) rounded-(--radius) rounded-tr-none p-3 space-y-3">
        {tab === 'cash' ? (
          <EquityAdjustmentsPanel adjustments={adjustments} />
        ) : (
          <BrokerFeesPanel adjustments={adjustments} />
        )}
      </div>
    </section>
  )
}
