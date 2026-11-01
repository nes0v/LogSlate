import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QtyInputProps {
  value: number
  onChange: (v: number) => void
  className?: string
}

// Integer quantity input with stacked +/- buttons that fill the input's
// right edge (no gap top/bottom/right). Replaces the browser-default
// number spinner for a consistent look across platforms.
export function QtyInput({ value, onChange, className }: QtyInputProps) {
  const inc = () => onChange(value + 1)
  const dec = () => onChange(Math.max(1, value - 1))
  // What's typed while the field is empty. Without it, clearing the field
  // snaps straight back to 1 and typing "3" reads "13". Blur restores `value`.
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div
      className={cn(
        'h-8 flex items-stretch bg-(--color-bg) rounded-(--radius) overflow-hidden',
        'focus-within:ring-2 focus-within:ring-(--color-accent-soft)',
        className,
      )}
    >
      <input
        type="text"
        aria-label="Contracts"
        value={draft ?? value}
        onChange={e => {
          const digits = e.target.value.replace(/\D/g, '')
          const n = Number(digits)
          if (digits === '' || n < 1) {
            setDraft(digits)
            return
          }
          setDraft(null)
          onChange(n)
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={e => {
          // Enter would submit `value` while the field shows blank/0; put
          // the real value back instead so what's saved is what's shown.
          if (e.key === 'Enter' && draft !== null) {
            e.preventDefault()
            setDraft(null)
          }
        }}
        className="flex-1 min-w-0 bg-transparent px-2.5 text-sm text-(--color-text) outline-none"
      />
      <div className="flex flex-col w-6 border-l border-(--color-panel)">
        <button
          type="button"
          tabIndex={-1}
          onClick={inc}
          aria-label="Increment"
          className="flex-1 flex items-center justify-center text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={dec}
          aria-label="Decrement"
          className="flex-1 flex items-center justify-center text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
        >
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  )
}
