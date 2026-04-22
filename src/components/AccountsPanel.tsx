import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import {
  countAccountData,
  createAccount,
  deleteAccount,
  listAccounts,
  renameAccount,
} from '@/db/queries'
import { MAIN_ACCOUNT_ID } from '@/db/types'
import { setActiveAccountId, useActiveAccountId } from '@/lib/active-account'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { cn } from '@/lib/utils'

export function AccountsPanel() {
  const accounts = useLiveQuery(() => listAccounts(), [], [])
  const activeId = useActiveAccountId()
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createAccount({ name: newName })
      setNewName('')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleRenameSave() {
    if (!editingId) return
    try {
      await renameAccount(editingId, editingName)
      setEditingId(null)
      setEditingName('')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete(id: string, name: string) {
    const counts = await countAccountData(id)
    const msg =
      counts.trades === 0 && counts.adjustments === 0
        ? `Delete account "${name}"?`
        : `Delete account "${name}"? This will permanently remove ${counts.trades} trade${
            counts.trades === 1 ? '' : 's'
          } and ${counts.adjustments} adjustment${counts.adjustments === 1 ? '' : 's'}.`
    if (!confirm(msg)) return
    try {
      if (activeId === id) setActiveAccountId(MAIN_ACCOUNT_ID)
      await deleteAccount(id)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const list = accounts ?? []

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Accounts</h2>
      <p className="text-sm text-(--color-text-dim)">
        Each account has its own trades, adjustments, and equity curve. All accounts sync
        together. The Main account cannot be deleted.
      </p>

      {list.length > 0 && (
        <div className="bg-(--color-panel) border border-(--color-border) rounded-md divide-y divide-(--color-border)">
          {list.map(a => {
            const isEditing = editingId === a.id
            return (
              <div
                key={a.id}
                className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2"
              >
                {isEditing ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void handleRenameSave()
                      if (e.key === 'Escape') {
                        setEditingId(null)
                        setEditingName('')
                      }
                    }}
                    autoFocus
                    className={inputClass}
                  />
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm truncate">{a.name}</span>
                    {a.id === activeId && (
                      <span className="text-[10px] uppercase tracking-wide text-(--color-accent)">
                        active
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1 justify-self-end">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleRenameSave()}
                        aria-label="Save"
                        className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-win) hover:bg-(--color-panel-2)"
                      >
                        <Check className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null)
                          setEditingName('')
                        }}
                        aria-label="Cancel"
                        className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
                      >
                        <X className="size-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(a.id)
                        setEditingName(a.name)
                      }}
                      aria-label="Rename"
                      className="p-1 rounded-md text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={a.is_main}
                  onClick={() => void handleDelete(a.id, a.name)}
                  aria-label="Delete account"
                  className={cn(
                    'p-1 rounded-md',
                    a.is_main
                      ? 'text-(--color-text-dim)/40 cursor-not-allowed'
                      : 'text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)',
                  )}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="bg-(--color-panel) border border-(--color-border) rounded-md p-3 grid grid-cols-[1fr_auto] gap-3 items-end"
      >
        <label className="text-xs text-(--color-text-dim) space-y-2">
          <div>New account name</div>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Funded challenge"
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded-md border border-transparent bg-(--color-accent) text-white hover:opacity-90"
        >
          Add
        </button>
        {error && <div className="col-span-2 text-xs text-(--color-loss)">{error}</div>}
      </form>
    </section>
  )
}
