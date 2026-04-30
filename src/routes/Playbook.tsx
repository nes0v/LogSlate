import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, Plus, Trash2 } from 'lucide-react'
import { db } from '@/db/schema'
import type { Playbook, PlaybookRuleGroup, SymbolKey } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { Checkbox } from '@/components/form/Checkbox'
import { cn } from '@/lib/utils'

function newId(): string {
  return crypto.randomUUID()
}

const DEFAULT_GROUPS = (): PlaybookRuleGroup[] => [
  { id: newId(), name: 'Entry', rules: [] },
  { id: newId(), name: 'Exit', rules: [] },
  { id: newId(), name: 'Risk management', rules: [] },
]

export function PlaybookRoute() {
  const accountId = useActiveAccountId()
  const playbooks = useLiveQuery(
    () =>
      db.playbooks
        .where('account_id')
        .equals(accountId)
        .reverse()
        .sortBy('updated_at'),
    [accountId],
    [],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const visible = useMemo(
    () => (playbooks ?? []).filter(p => showArchived || !p.archived),
    [playbooks, showArchived],
  )
  const selected = useMemo(() => {
    const list = visible
    if (selectedId) {
      const m = list.find(p => p.id === selectedId)
      if (m) return m
    }
    return list[0] ?? null
  }, [visible, selectedId])

  async function createPlaybook() {
    const ts = new Date().toISOString()
    const p: Playbook = {
      id: newId(),
      account_id: accountId,
      name: 'New model',
      description: '',
      symbols: [],
      groups: DEFAULT_GROUPS(),
      archived: false,
      created_at: ts,
      updated_at: ts,
    }
    await db.playbooks.put(p)
    setSelectedId(p.id)
  }

  async function update(patch: Partial<Playbook>) {
    if (!selected) return
    await db.playbooks.update(selected.id, {
      ...patch,
      updated_at: new Date().toISOString(),
    })
  }

  async function remove() {
    if (!selected) return
    if (!confirm(`Delete "${selected.name}" permanently?`)) return
    const id = selected.id
    setSelectedId(null)
    await db.playbooks.delete(id)
  }

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Models</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-(--color-text-dim) flex items-center gap-2 cursor-pointer">
            <Checkbox
              size="sm"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          <button
            type="button"
            onClick={createPlaybook}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-(--radius) bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90"
          >
            <Plus className="size-4" /> New model
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3 min-h-[60vh]">
        <aside className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 max-h-[80vh] overflow-y-auto">
          {visible.length === 0 ? (
            <div className="text-xs text-(--color-text-dim) text-center py-6">
              No models yet — start with "New model".
            </div>
          ) : (
            <div className="space-y-0.5">
              {visible.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'block w-full text-left px-2 py-1.5 rounded-sm text-sm transition-colors',
                    selected?.id === p.id
                      ? 'bg-(--color-panel-2) text-(--color-text)'
                      : 'text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)/50',
                  )}
                >
                  <div className="truncate flex items-center justify-between">
                    <span>{p.name}</span>
                    {p.archived && (
                      <span className="text-xs uppercase tracking-wider text-(--color-text-dim)">
                        archived
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-(--color-text-dim) truncate">
                    {p.symbols.length > 0 ? p.symbols.join(', ') : 'any symbol'} ·{' '}
                    {p.groups.reduce((n, g) => n + g.rules.length, 0)} rules
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        {selected ? (
          <PlaybookEditor
            key={selected.id}
            playbook={selected}
            onChange={update}
            onDelete={remove}
          />
        ) : (
          <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-12 text-center text-sm text-(--color-text-dim)">
            Select a model on the left, or create one.
          </div>
        )}
      </div>
    </div>
  )
}

interface PlaybookEditorProps {
  playbook: Playbook
  onChange: (patch: Partial<Playbook>) => void
  onDelete: () => void
}
function PlaybookEditor({ playbook, onChange, onDelete }: PlaybookEditorProps) {
  const [name, setName] = useState(playbook.name)
  const [description, setDescription] = useState(playbook.description)
  const [groups, setGroups] = useState<PlaybookRuleGroup[]>(playbook.groups)
  const [symbols, setSymbols] = useState<SymbolKey[]>(playbook.symbols)

  function commit(patch: Partial<Playbook>) {
    onChange(patch)
  }

  function toggleSymbol(s: SymbolKey) {
    const next = symbols.includes(s) ? symbols.filter(x => x !== s) : [...symbols, s]
    setSymbols(next)
    commit({ symbols: next })
  }

  function addRule(groupId: string) {
    const next = groups.map(g =>
      g.id === groupId ? { ...g, rules: [...g.rules, ''] } : g,
    )
    setGroups(next)
    commit({ groups: next })
  }
  function setRule(groupId: string, idx: number, text: string) {
    const next = groups.map(g =>
      g.id === groupId
        ? { ...g, rules: g.rules.map((r, i) => (i === idx ? text : r)) }
        : g,
    )
    setGroups(next)
  }
  function commitRules(next: PlaybookRuleGroup[]) {
    commit({ groups: next })
  }
  function deleteRule(groupId: string, idx: number) {
    const next = groups.map(g =>
      g.id === groupId ? { ...g, rules: g.rules.filter((_, i) => i !== idx) } : g,
    )
    setGroups(next)
    commit({ groups: next })
  }
  function addGroup() {
    const next = [...groups, { id: newId(), name: 'New group', rules: [] }]
    setGroups(next)
    commit({ groups: next })
  }
  function setGroupName(groupId: string, text: string) {
    const next = groups.map(g => (g.id === groupId ? { ...g, name: text } : g))
    setGroups(next)
  }
  function deleteGroup(groupId: string) {
    if (!confirm('Delete this group and all its rules?')) return
    const next = groups.filter(g => g.id !== groupId)
    setGroups(next)
    commit({ groups: next })
  }

  return (
    <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => commit({ name })}
          placeholder="Model name"
          className="flex-1 bg-transparent border-0 outline-none text-lg font-medium"
        />
        <button
          type="button"
          onClick={() => commit({ archived: !playbook.archived })}
          className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          title={playbook.archived ? 'Unarchive' : 'Archive'}
        >
          {playbook.archived ? (
            <ArchiveRestore className="size-4" />
          ) : (
            <Archive className="size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-loss) hover:bg-(--color-panel-2)"
          title="Delete"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        onBlur={() => commit({ description })}
        placeholder="Describe the setup, market conditions, when to use it…"
        className="w-full min-h-[80px] bg-(--color-bg) rounded-(--radius) p-2 text-sm outline-none focus:ring-2 focus:ring-(--color-accent-soft) resize-y transition-colors"
      />

      <div>
        <div className="text-xs uppercase tracking-wider text-(--color-text-dim) mb-1">
          Symbols
        </div>
        <div className="flex gap-1">
          {(['NQ', 'ES'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => toggleSymbol(s)}
              className={cn(
                'px-2 py-1 text-xs rounded border transition-colors',
                symbols.includes(s)
                  ? 'border-(--color-accent) text-(--color-accent) bg-(--color-accent)/10'
                  : 'border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)',
              )}
            >
              {s}
            </button>
          ))}
          <span className="text-xs text-(--color-text-dim) self-center pl-2">
            {symbols.length === 0 ? 'all symbols' : ''}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {groups.map(g => (
          <div
            key={g.id}
            className="bg-(--color-panel-2) rounded-(--radius) p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <input
                value={g.name}
                onChange={e => setGroupName(g.id, e.target.value)}
                onBlur={() => commitRules(groups)}
                placeholder="Group name"
                className="bg-transparent border-0 outline-none text-sm font-medium flex-1"
              />
              <button
                type="button"
                onClick={() => deleteGroup(g.id)}
                className="p-1 rounded text-(--color-text-dim) hover:text-(--color-loss)"
                title="Delete group"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              {g.rules.length === 0 && (
                <div className="text-xs text-(--color-text-dim) italic">
                  No rules yet.
                </div>
              )}
              {g.rules.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-(--color-text-dim) text-xs font-mono tabular-nums w-5 text-right shrink-0">
                    {i + 1}.
                  </span>
                  <input
                    value={r}
                    onChange={e => setRule(g.id, i, e.target.value)}
                    onBlur={() => commitRules(groups)}
                    placeholder="Rule…"
                    className="flex-1 bg-transparent border-0 outline-none text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => deleteRule(g.id, i)}
                    className="p-1 rounded text-(--color-text-dim) hover:text-(--color-loss)"
                    title="Remove rule"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addRule(g.id)}
                className="text-xs text-(--color-text-dim) hover:text-(--color-text) inline-flex items-center gap-1 mt-1"
              >
                <Plus className="size-3" /> Add rule
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addGroup}
          className="text-xs text-(--color-text-dim) hover:text-(--color-text) inline-flex items-center gap-1"
        >
          <Plus className="size-3" /> Add group
        </button>
      </div>
    </div>
  )
}
