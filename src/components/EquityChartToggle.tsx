import { cn } from '@/lib/utils'

export type EquityView = 'curve' | 'candles'

interface EquityChartToggleProps {
  value: EquityView
  onChange: (v: EquityView) => void
}

export function EquityChartToggle({ value, onChange }: EquityChartToggleProps) {
  return (
    <div className="flex gap-1 text-xs font-mono">
      <ToggleButton active={value === 'curve'} onClick={() => onChange('curve')}>
        Line
      </ToggleButton>
      <ToggleButton active={value === 'candles'} onClick={() => onChange('candles')}>
        Candles
      </ToggleButton>
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded-md border transition-colors',
        active
          ? 'border-(--color-border) bg-(--color-panel-2) text-(--color-text)'
          : 'border-transparent text-(--color-text-dim) hover:text-(--color-text)',
      )}
    >
      {children}
    </button>
  )
}
