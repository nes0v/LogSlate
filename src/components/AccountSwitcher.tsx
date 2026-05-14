import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, User } from 'lucide-react'
import { MAIN_ACCOUNT_ID, type Account } from '@/db/types'
import {
  getActiveAccountId,
  setActiveAccountId,
  useActiveAccountId,
} from '@/lib/active-account'
import { cn } from '@/lib/utils'

interface AccountSwitcherProps {
  /** Resolved account list. Lifted from `Layout` so the global nav can
   *  hide the whole right-side cluster until accounts + equity are both
   *  ready, instead of showing a placeholder name that snaps to the
   *  real one. */
  accounts: Account[]
}

export function AccountSwitcher({ accounts }: AccountSwitcherProps) {
  const activeId = useActiveAccountId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // If the active account was deleted (e.g. by a sync from another device),
  // fall back to a real account so the UI doesn't render an empty dataset
  // forever. Prefer MAIN when it exists; otherwise take whichever account
  // happens to be first (covers the case where the user has deleted MAIN
  // and only synced other accounts in).
  useEffect(() => {
    if (accounts.length === 0) return
    const current = getActiveAccountId()
    if (accounts.some(a => a.id === current)) return
    const main = accounts.find(a => a.id === MAIN_ACCOUNT_ID)
    setActiveAccountId(main?.id ?? accounts[0].id)
  }, [accounts])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = accounts.find(a => a.id === activeId) ?? accounts.find(a => a.is_main)
  const activeName = active?.name ?? 'Main'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'h-8 flex items-center justify-between gap-2 pl-2.5 pr-2 text-sm rounded-(--radius)',
          'bg-(--color-bg) text-(--color-text) cursor-pointer transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-(--color-accent-soft)',
        )}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <User className="size-4 shrink-0 text-(--color-text-dim)" />
          <span className="max-w-40 truncate">{activeName}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-(--color-text-dim)" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-(--color-panel) border border-(--color-border-strong) rounded-(--radius) overflow-hidden">
          {accounts.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setActiveAccountId(a.id)
                setOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-left whitespace-nowrap cursor-pointer transition-colors',
                a.id === activeId
                  ? 'bg-(--color-panel-2) text-(--color-text)'
                  : 'text-(--color-text-dim) hover:bg-(--color-panel-2) hover:text-(--color-text)',
              )}
            >
              <Check
                className={cn(
                  'size-3.5',
                  a.id === activeId ? 'text-(--color-accent)' : 'opacity-0',
                )}
              />
              <span className="truncate">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
