import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null
  onChange: (v: number | null) => void
}

// Number entry that keeps the user's typed string buffered locally so
// partial values like "1." aren't clobbered when the parent re-renders
// from a number-typed form value. `type="text"` + `inputMode="decimal"`
// gets a numeric soft-keyboard on mobile while still letting the user
// type any character.
//
// `w-full min-w-0` is baked in so the input can shrink below its
// intrinsic ~150px size when placed in a grid/flex cell.
export function NumberInput({ value, onChange, className, ...rest }: NumberInputProps) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const focused = useRef(false)

  useEffect(() => {
    if (focused.current) return
    setText(value === null ? '' : String(value))
  }, [value])

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
        focused.current = false
        setText(value === null ? '' : String(value))
      }}
      onChange={e => {
        const t = e.target.value
        setText(t)
        if (t === '' || t === '-') {
          onChange(null)
          return
        }
        const n = Number(t)
        if (!Number.isNaN(n)) onChange(n)
      }}
      {...rest}
    />
  )
}
