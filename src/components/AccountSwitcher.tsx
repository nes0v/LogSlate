import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronDown, User } from 'lucide-react'
import { listAccounts } from '@/db/queries'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import {
  getActiveAccountId,
  setActiveAccountId,
  useActiveAccountId,
} from '@/lib/active-account'
import { cn } from '@/lib/utils'

export function AccountSwitcher() {
  const accounts = useLiveQuery(() => listAccounts(), [], [])
  const activeId = useActiveAccountId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // If the active account was deleted (e.g. by a sync from another device),
  // fall back to Main so the UI doesn't render an empty dataset forever.
  useEffect(() => {
    if (!accounts || accounts.length === 0) return
    const current = getActiveAccountId()
    if (!accounts.some(a => a.id === current)) {
      setActiveAccountId(MAIN_ACCOUNT_ID)
    }
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

  const active = accounts?.find(a => a.id === activeId) ?? accounts?.find(a => a.is_main)
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
      {open && accounts && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-(--color-panel) border border-(--color-border-strong) rounded-(--radius) shadow-(--shadow-md) overflow-hidden">
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
