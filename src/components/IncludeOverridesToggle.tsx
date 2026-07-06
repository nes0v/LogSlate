import { Switch } from '@/components/form/Switch'

/**
 * "Include override days" toggle. Lives in the Overview / Reports page header.
 * When `disabled`, overrides can't apply to the active filter (or report tab):
 * the user's intent is preserved, only the rendered state is locked off and a
 * tooltip explains why.
 */
export function IncludeOverridesToggle({
  checked,
  disabled,
  disabledReason,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  disabledReason?: string
  onChange: (next: boolean) => void
}) {
  return (
    <Switch
      label="Show override days"
      checked={disabled ? false : checked}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onChange={onChange}
      className="select-none rounded-(--radius) px-2 py-1.5 whitespace-nowrap"
    />
  )
}
