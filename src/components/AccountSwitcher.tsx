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
        className="inline-flex items-center gap-1.5 px-2 py-1 text-sm rounded-md border border-(--color-border) text-(--color-text) hover:bg-(--color-panel-2)"
      >
        <User className="size-4 text-(--color-text-dim)" />
        <span className="max-w-40 truncate">{activeName}</span>
        <ChevronDown className="size-3.5 text-(--color-text-dim)" />
      </button>
      {open && accounts && (
        <div className="absolute left-0 top-full mt-1 min-w-52 rounded-md border border-(--color-border) bg-(--color-panel) shadow-lg z-20 py-1">
          {accounts.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setActiveAccountId(a.id)
                setOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                'hover:bg-(--color-panel-2)',
                a.id === activeId && 'text-(--color-text)',
              )}
            >
              <Check
                className={cn(
                  'size-3.5',
                  a.id === activeId ? 'text-(--color-accent)' : 'opacity-0',
                )}
              />
              <span className="truncate">{a.name}</span>
              {a.is_main && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-(--color-text-dim)">
                  main
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
