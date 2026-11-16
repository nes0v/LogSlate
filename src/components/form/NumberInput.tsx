import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null
  onChange: (v: number | null) => void
  decimals?: number
}

// Number entry that keeps the user's typed string buffered locally so
// partial values like "1." aren't clobbered when the parent re-renders
// from a number-typed form value. `type="text"` so the user can type any
// character while editing; text that isn't a number reports null.
//
// `w-full min-w-0` is baked in so the input can shrink below its
// intrinsic ~150px size when placed in a grid/flex cell.
export function NumberInput({ value, onChange, onBlur, className, decimals, ...rest }: NumberInputProps) {
  const format = (v: number | null) =>
    v === null ? '' : decimals != null ? v.toFixed(decimals) : String(v)
  const [text, setText] = useState(() => format(value))
  const focused = useRef(false)

  useEffect(() => {
    if (focused.current) return
    setText(format(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals])

  return (
    <input
      type="text"
      className={cn('w-full min-w-0', className)}
      value={text}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={e => {
        // Alt-tabbing to another window blurs the input even though focus
        // stays on it within the page. Only commit the formatted value on a
        // genuine in-app blur (document still focused); otherwise keep the
        // raw buffer so the user can resume typing when they return.
        if (!document.hasFocus()) return
        focused.current = false
        setText(format(value))
        // Chained, not spread: `...rest` lands after this prop, so a caller's
        // onBlur would otherwise replace the commit logic above. It only runs
        // on a genuine in-app blur — alt-tabbing away skips it, like the
        // commit above.
        onBlur?.(e)
      }}
      onChange={e => {
        const t = e.target.value
        setText(t)
        if (t.trim() === '') {
          onChange(null)
          return
        }
        const n = Number(t)
        // Text that isn't a whole number reports null — never the last
        // number that parsed, or "2,000" would hold the 2 typed before the
        // comma. Commas aren't supported: the box clears on blur. Surrounding
        // spaces (a pasted "2000 ") are fine. `Number.isFinite` (not
        // `!isNaN`) so "Infinity" is rejected too — it'd otherwise pass
        // `> 0` validation and poison downstream PNL/R math into NaN.
        onChange(Number.isFinite(n) ? n : null)
      }}
      {...rest}
    />
  )
}