import type { Timeframe } from '@/lib/buckets'
import { Dropdown } from '@/components/Dropdown'

interface ChartTimeframeToggleProps {
  value: Timeframe
  onChange: (v: Timeframe) => void
}

const OPTIONS: Array<{ value: Timeframe; label: string }> = [
  { value: 'D', label: '1 day' },
  { value: 'W', label: '1 week' },
  { value: 'M', label: '1 month' },
  { value: 'Q', label: '3 months' },
  { value: 'Y', label: '12 months' },
]

export function ChartTimeframeToggle({ value, onChange }: ChartTimeframeToggleProps) {
  return (
    <Dropdown<Timeframe>
      value={value}
      onChange={onChange}
      ariaLabel="Chart timeframe"
      trigger={value}
      options={OPTIONS}
    />
  )
}
