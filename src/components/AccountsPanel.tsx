import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import {
  countAccountData,
  createAccount,
  deleteAccount,
} from '@/db/queries'
import type { Account } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClassCompact as inputClass } from '@/components/form/Field'
import { BTN_ACCENT } from '@/components/form/buttonClass'
import { errorMessage } from '@/lib/utils'

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
    const parts: string[] = []
    const push = (n: number, singular: string, plural = `${singular}s`) => {
      if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`)
    }
    push(counts.trades, 'trade')
    push(counts.adjustments, 'adjustment')
    push(counts.days, 'day note/screenshots entry', 'day note/screenshot entries')
    push(counts.models, 'model')
    push(counts.symbols, 'symbol')
    push(counts.progressRules, 'progress rule')
    push(counts.progressChecks, 'historical check')
    const description = parts.length === 0
      ? undefined
      : `This will permanently remove ${parts.join(', ')}.`
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
    <section>
      <h2 className="text-sm font-medium mb-2">Accounts</h2>
      <div className="rounded-(--radius) bg-(--color-panel) p-3 space-y-3">
        {/* Account names map 1:1 to a Drive folder, so they're fixed once
            created — renaming would orphan the existing folder of screenshots. */}
        <p className="text-sm text-(--color-text-dim)">
          Each account has its own trades, adjustments, and equity curve.
          <br />
          Names are fixed at creation, they map to the Drive screenshot folder.
        </p>

        <form
          onSubmit={handleCreate}
          className="bg-(--color-panel-2) rounded-(--radius) p-3 grid grid-cols-[1fr_auto] gap-3 items-end"
        >
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Account..."
            aria-label="New account name"
            className={inputClass}
          />
          <button type="submit" className={BTN_ACCENT}>
            Add
          </button>
          {error && <div className="col-span-2 text-xs text-(--color-loss)">{error}</div>}
        </form>

        {list.length > 0 && (
          <div className="bg-(--color-panel-2) rounded-(--radius) overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {list.map(a => {
                  const isActive = a.id === activeId
                  return (
                    <tr
                      key={a.id}
                      className="border-t border-(--color-panel) first:border-t-0 hover:bg-(--color-panel-3)/60"
                    >
                      <td className="px-3 py-2">
                        <span className="truncate">{a.name}</span>
                      </td>
                      <td className="px-3 py-2 w-10 text-right">
                        {isActive ? (
                          <span
                            aria-label="Active account"
                            title="Active account"
                            className="inline-flex items-center justify-center p-1 text-(--color-accent)"
                          >
                            <Check className="size-3.5" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleDelete(a.id, a.name)}
                            aria-label="Delete account"
                            title="Delete account"
                            className="p-1 rounded-(--radius) text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-3)"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
