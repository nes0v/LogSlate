import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null
  onChange: (v: number | null) => void
  decimals?: number
}

// Number entry that keeps the user's typed string buffered locally so
// partial values like "1." aren't clobbered when the parent re-renders
// from a number-typed form value. `type="text"` + `inputMode="decimal"`
// gets a numeric soft-keyboard on mobile while still letting the user
// type any character.
//
// `w-full min-w-0` is baked in so the input can shrink below its
// intrinsic ~150px size when placed in a grid/flex cell.
export function NumberInput({ value, onChange, className, decimals, ...rest }: NumberInputProps) {
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
      inputMode="decimal"
      className={cn('w-full min-w-0', className)}
      value={text}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        // Alt-tabbing to another window blurs the input even though focus
        // stays on it within the page. Only commit the formatted value on a
        // genuine in-app blur (document still focused); otherwise keep the
        // raw buffer so the user can resume typing when they return.
        if (!document.hasFocus()) return
        focused.current = false
        setText(format(value))
      }}
      onChange={e => {
        const t = e.target.value
        setText(t)
        if (t === '' || t === '-') {
          onChange(null)
          return
        }
        const n = Number(t)
        // `Number.isFinite` (not `!isNaN`) so "Infinity"/"-Infinity" are
        // rejected — they'd otherwise pass `> 0` validation and poison
        // downstream PnL/R math into NaN.
        if (Number.isFinite(n)) onChange(n)
      }}
      {...rest}
    />
  )
}
