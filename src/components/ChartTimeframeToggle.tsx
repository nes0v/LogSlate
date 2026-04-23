import type { Timeframe } from '@/lib/buckets'
import { cn } from '@/lib/utils'

interface ChartTimeframeToggleProps {
  value: Timeframe
  onChange: (v: Timeframe) => void
}

const OPTS: Timeframe[] = ['D', 'W', 'M', 'Q', 'Y']

export function ChartTimeframeToggle({ value, onChange }: ChartTimeframeToggleProps) {
  return (
    <div className="flex gap-1 text-xs font-mono">
      {OPTS.map(tf => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          className={cn(
            'px-2 py-1 rounded-md border transition-colors',
            value === tf
              ? 'border-(--color-border) bg-(--color-panel-2) text-(--color-text)'
              : 'border-transparent text-(--color-text-dim) hover:text-(--color-text)',
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  )
}
