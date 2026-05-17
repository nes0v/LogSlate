import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RuleCheckProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  /** Rule is currently archived (Progress: deleted but kept for past
   *  adherence). Renders the label with italics + a struck-through tone
   *  so the user can tell this is a historical rule they can no longer
   *  see in the today checklist. */
  archived?: boolean
  className?: string
}

// Rule-followed checkbox: a green check when ok, a red X when not.
// Used in two places where the visual must stay in sync — the daily
// Progress checklist and the per-trade ModelRuleChecklist.
export function RuleCheck({ checked, onChange, label, archived, className }: RuleCheckProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-1.5 px-1 py-1 rounded-sm cursor-pointer hover:bg-(--color-panel-3)',
        className,
      )}
    >
      <span className="relative size-4 inline-flex items-center justify-center shrink-0 mt-px">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="peer absolute inset-0 size-full opacity-0 cursor-pointer"
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
          archived && 'italic text-(--color-text-faint) line-through',
        )}
        title={archived ? 'Archived rule — kept for historical adherence' : undefined}
      >
        {label}
      </span>
    </label>
  )
}
