import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, Plus, Trash2, X } from 'lucide-react'
import { db } from '@/db/schema'
import type { Model, ModelRuleGroup, Session, SymbolKey } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { Checkbox } from '@/components/form/Checkbox'
import { inputClass } from '@/components/form/Field'
import { Pills } from '@/components/form/Pills'
import { SESSION_OPTS, SYMBOL_OPTS } from '@/lib/filter-options'
import { cn } from '@/lib/utils'

function newId(): string {
  return crypto.randomUUID()
}

const DEFAULT_GROUPS = (): ModelRuleGroup[] => [
  { id: newId(), name: 'Entry', rules: [] },
  { id: newId(), name: 'Exit', rules: [] },
  { id: newId(), name: 'Risk', rules: [] },
]

export function ModelsRoute() {
  const accountId = useActiveAccountId()
  const models = useLiveQuery(
    () =>
      db.models
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
    () => (models ?? []).filter(p => showArchived || !p.archived),
    [models, showArchived],
  )
  const selected = useMemo(() => {
    const list = visible
    if (selectedId) {
      const m = list.find(p => p.id === selectedId)
      if (m) return m
    }
    return list[0] ?? null
  }, [visible, selectedId])

  async function createModel() {
    const ts = new Date().toISOString()
    const p: Model = {
      id: newId(),
      account_id: accountId,
      name: 'New model',
      description: '',
      symbols: [],
      sessions: [],
      groups: DEFAULT_GROUPS(),
      archived: false,
      created_at: ts,
      updated_at: ts,
    }
    await db.models.put(p)
    setSelectedId(p.id)
  }

  async function update(patch: Partial<Model>) {
    if (!selected) return
    await db.models.update(selected.id, {
      ...patch,
      updated_at: new Date().toISOString(),
    })
  }

  async function remove() {
    if (!selected) return
    if (!confirm(`Delete "${selected.name}" permanently?`)) return
    const id = selected.id
    setSelectedId(null)
    await db.models.delete(id)
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
            onClick={createModel}
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
                    'block w-full text-left p-3 rounded-sm text-sm transition-colors',
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
          <ModelEditor
            key={selected.id}
            model={selected}
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

interface ModelEditorProps {
  model: Model
  onChange: (patch: Partial<Model>) => void
  onDelete: () => void
}
function ModelEditor({ model, onChange, onDelete }: ModelEditorProps) {
  const [name, setName] = useState(model.name)
  const [description, setDescription] = useState(model.description)
  const [groups, setGroups] = useState<ModelRuleGroup[]>(model.groups)
  const [symbols, setSymbols] = useState<SymbolKey[]>(model.symbols)
  const [sessions, setSessions] = useState<Session[]>(model.sessions)

  function commit(patch: Partial<Model>) {
    onChange(patch)
  }

  function setSymbol(s: SymbolKey | null) {
    const next: SymbolKey[] = s ? [s] : []
    setSymbols(next)
    commit({ symbols: next })
  }
  function setSession(s: Session | null) {
    const next: Session[] = s ? [s] : []
    setSessions(next)
    commit({ sessions: next })
  }
  // Multi-element arrays from older multi-select UI collapse to "All" here;
  // single-element arrays surface their lone value.
  const symbolValue: SymbolKey | null = symbols.length === 1 ? symbols[0] : null
  const sessionValue: Session | null = sessions.length === 1 ? sessions[0] : null

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
  function commitRules(next: ModelRuleGroup[]) {
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
          onClick={() => commit({ archived: !model.archived })}
          className="p-1.5 rounded text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)"
          title={model.archived ? 'Unarchive' : 'Archive'}
        >
          {model.archived ? (
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
        className={cn(inputClass, 'w-full min-h-[80px] resize-y')}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col items-start gap-2">
          <span className="text-xs text-(--color-text-dim)">Symbol</span>
          <Pills value={symbolValue} onChange={setSymbol} options={SYMBOL_OPTS} />
        </div>
        <div className="flex flex-col items-start gap-2">
          <span className="text-xs text-(--color-text-dim)">Session</span>
          <Pills value={sessionValue} onChange={setSession} options={SESSION_OPTS} />
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
                    <X className="size-3.5" />
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
