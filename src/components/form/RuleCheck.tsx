import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RuleCheckProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  /** Small faint text after the label — the Progress checklist uses it to
   *  say when a rule shown on this day has since been archived. */
  note?: string
  /** Not tickable — the Progress checklist uses this on every day but
   *  today, and on today too at the weekend. */
  disabled?: boolean
  className?: string
}

// Rule-followed checkbox: a green check when ok, a red X when not.
// Used in two places where the visual must stay in sync — the daily
// Progress checklist and the per-trade ModelRuleChecklist.
export function RuleCheck({
  checked,
  onChange,
  label,
  note,
  disabled,
  className,
}: RuleCheckProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-1.5 px-1 py-1 rounded-sm',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer hover:bg-(--color-panel-3)',
        className,
      )}
    >
      <span className="relative size-4 inline-flex items-center justify-center shrink-0 mt-px">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          className={cn(
            'peer absolute inset-0 size-full opacity-0',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        />
        {checked ? (
          <Check
            aria-hidden
            strokeWidth={3}
            className="size-3.5 text-(--color-win)"
          />
        ) : (
          <X
            aria-hidden
            strokeWidth={3}
            className="size-3.5 text-(--color-loss)"
          />
        )}
      </span>
      <span
        className={cn(
          'text-sm leading-tight',
          checked ? 'text-(--color-text)' : 'text-(--color-text-dim)',
        )}
      >
        {label}
      </span>
      {note && (
        <span className="ml-auto text-xs text-(--color-text-faint) shrink-0 mt-px">
          {note}
        </span>
      )}
    </label>
  )
}
