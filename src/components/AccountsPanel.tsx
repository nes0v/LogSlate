import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  countAccountData,
  createAccount,
  deleteAccount,
} from '@/db/queries'
import type { Account } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { cn, errorMessage } from '@/lib/utils'

interface AccountsPanelProps {
  accounts: Account[]
}

export function AccountsPanel({ accounts }: AccountsPanelProps) {
  const activeId = useActiveAccountId()
  const confirm = useConfirm()
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createAccount({ name: newName })
      setNewName('')
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function handleDelete(id: string, name: string) {
    const counts = await countAccountData(id)
    const description =
      counts.trades === 0 && counts.adjustments === 0
        ? undefined
        : `This will permanently remove ${counts.trades} trade${
            counts.trades === 1 ? '' : 's'
          } and ${counts.adjustments} adjustment${counts.adjustments === 1 ? '' : 's'}.`
    if (!(await confirm({ title: `Delete account "${name}"?`, description }))) return
    try {
      await deleteAccount(id)
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const list = accounts

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Accounts</h2>
      {/* Account names map 1:1 to a Drive folder, so they're fixed once
          created — renaming would orphan the existing folder of screenshots. */}
      <p className="text-sm text-(--color-text-dim)">
        Each account has its own trades, adjustments, and equity curve.
        <br />
        Names are fixed at creation, they map to the Drive screenshot folder.
        <br />
        The active account can't be deleted — switch to another account first.
      </p>

      <form
        onSubmit={handleCreate}
        className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-drop-xs) p-3 grid grid-cols-[1fr_auto] gap-3 items-end"
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
          className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded-(--radius) border border-transparent bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90"
        >
          Add
        </button>
        {error && <div className="col-span-2 text-xs text-(--color-loss)">{error}</div>}
      </form>

      {list.length > 0 && (
        <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-drop-xs) overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {list.map(a => {
                const isActive = a.id === activeId
                return (
                  <tr
                    key={a.id}
                    className="border-t border-(--color-bg) first:border-t-0 hover:bg-(--color-panel-2)/60"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{a.name}</span>
                        {isActive && (
                          <span className="text-xs uppercase tracking-wide text-(--color-accent)">
                            active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 w-10 text-right">
                      <button
                        type="button"
                        disabled={isActive}
                        onClick={() => void handleDelete(a.id, a.name)}
                        aria-label="Delete account"
                        title={isActive ? 'Switch to another account to delete this one' : 'Delete account'}
                        className={cn(
                          'p-1 rounded-(--radius)',
                          isActive
                            ? 'text-(--color-text-dim)/40 cursor-not-allowed'
                            : 'text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)',
                        )}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
