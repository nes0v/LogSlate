import { Switch } from '@/components/form/Switch'

/**
 * "Show scratch trades" toggle for the Overview / Reports page header. On by
 * default; when off, scratch trades drop out of every stat and chart (global,
 * mirroring "Show override days"). Unlike overrides it has no disabled state —
 * scratches are a plain trade property, not gated by the active filter.
 */
export function ShowScratchesToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <Switch
      label="Show scratch trades"
      checked={checked}
      onChange={onChange}
      className="select-none rounded-(--radius) px-2 py-1.5 whitespace-nowrap"
    />
  )
}
