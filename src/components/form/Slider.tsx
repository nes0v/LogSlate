import type { CSSProperties } from 'react'

interface SliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  /** Fired on release (pointer up, key up, blur) — for callers that save
   *  once per drag rather than per step. */
  onCommit?: () => void
  /** The value as shown to the right of the track. */
  label: string
  ariaLabel: string
}

// Range slider styled by `.range` in index.css (thin track, accent fill up to
// the knob). The label has one fixed width for every slider, so stacked
// sliders' tracks end at the same x and don't shift as the label changes.
// Track and label share a 19px row: the 3px track and 13px knob both center
// on whole pixels in an odd height. Callers pad the card around it 10px top /
// 9px bottom, so it's 38px tall — the height of an Accounts row.
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  label,
  ariaLabel,
}: SliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.currentTarget.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        aria-label={ariaLabel}
        className="range flex-1"
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
      {/* Up 1px: Segoe UI's tall ascent sets digits ~1px below the line box's
          middle, which reads as low against the track. */}
      <span className="relative -top-px w-18 text-sm leading-[19px] tabular-nums text-right">
        {label}
      </span>
    </div>
  )
}
