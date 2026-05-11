import { useState } from 'react'
import type { EquityAdjustment } from '@/db/types'
import { BrokerFeesPanel } from '@/components/BrokerFeesPanel'
import { EquityAdjustmentsPanel } from '@/components/EquityAdjustmentsPanel'
import { Pills } from '@/components/form/Pills'

type Tab = 'cash' | 'fees'

interface AdjustmentsPanelProps {
  adjustments: EquityAdjustment[]
}

export function AdjustmentsPanel({ adjustments }: AdjustmentsPanelProps) {
  const [tab, setTab] = useState<Tab>('cash')
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Adjustments</h2>
        <Pills
          value={tab}
          onChange={setTab}
          options={[
            { value: 'cash', label: 'Deposits & withdrawals' },
            { value: 'fees', label: 'Monthly fees' },
          ]}
        />
      </div>
      {tab === 'cash' ? (
        <EquityAdjustmentsPanel adjustments={adjustments} />
      ) : (
        <BrokerFeesPanel adjustments={adjustments} />
      )}
    </section>
  )
}
