import { Dropdown } from '@/components/Dropdown'
import { cn } from '@/lib/utils'

export type EquityView = 'curve' | 'candles'

interface EquityChartToggleProps {
  value: EquityView
  onChange: (v: EquityView) => void
}

/** Custom inline SVGs — lucide's chart icons include the L-shaped
 *  axis (vertical + horizontal baseline) which the user wants stripped. */
function LineGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-4', className)}
      aria-hidden
    >
      <polyline points="3 16 9 10 13 14 21 6" />
    </svg>
  )
}

function CandleGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-4', className)}
      aria-hidden
    >
      <line x1="7" y1="3" x2="7" y2="6" />
      <rect x="5" y="6" width="4" height="9" />
      <line x1="7" y1="15" x2="7" y2="19" />
      <line x1="17" y1="6" x2="17" y2="9" />
      <rect x="15" y="9" width="4" height="7" />
      <line x1="17" y1="16" x2="17" y2="20" />
    </svg>
  )
}

export function EquityChartToggle({ value, onChange }: EquityChartToggleProps) {
  const Glyph = value === 'curve' ? LineGlyph : CandleGlyph
  return (
    <Dropdown<EquityView>
      value={value}
      onChange={onChange}
      ariaLabel="Chart type"
      trigger={<Glyph />}
      options={[
        {
          value: 'curve',
          label: (
            <span className="inline-flex items-center gap-2">
              <LineGlyph /> Line
            </span>
          ),
        },
        {
          value: 'candles',
          label: (
            <span className="inline-flex items-center gap-2">
              <CandleGlyph /> Candles
            </span>
          ),
        },
      ]}
    />
  )
}
