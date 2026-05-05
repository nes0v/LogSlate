import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, Plus, Save, Trash2, X } from 'lucide-react'
import { db } from '@/db/schema'
import { listModels } from '@/db/queries'
import type { Model, ModelRuleGroup, Session } from '@/db/types'
import { SESSIONS } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { Checkbox } from '@/components/form/Checkbox'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClass, insetTileClass } from '@/components/form/Field'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { SESSION_BG, SESSION_FG } from '@/lib/session-colors'
import { cn } from '@/lib/utils'

function newId(): string {
  return crypto.randomUUID()
}

const ACTION_BTN_BASE =
  'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-(--radius) border border-(--color-border) text-(--color-text-dim) transition-colors'
const NEUTRAL_BTN_CLASS = `${ACTION_BTN_BASE} hover:text-(--color-text)`
const DELETE_BTN_CLASS = `${ACTION_BTN_BASE} hover:text-(--color-loss)`

const DEFAULT_GROUPS = (): ModelRuleGroup[] => [
  { id: newId(), name: 'Entry', rules: [] },
  { id: newId(), name: 'Exit', rules: [] },
  { id: newId(), name: 'Risk', rules: [] },
]

export function ModelsRoute() {
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
  // No default value — `models` is undefined until Dexie resolves so we
  // can suppress the "No models yet" placeholder + empty editor pane on
  // the first paint frame (otherwise the page flickers on navigation).
  const models = useLiveQuery(() => listModels(accountId), [accountId])
  const loaded = models !== undefined
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
      sessions: [],
      groups: DEFAULT_GROUPS(),
      archived: false,
      created_at: ts,
      updated_at: ts,
    }
    await db.models.put(p)
    setSelectedId(p.id)
  }

  async function save(patch: Partial<Model>) {
    if (!selected) return
    await db.models.update(selected.id, {
      ...patch,
      updated_at: new Date().toISOString(),
    })
  }

  async function remove() {
    if (!selected) return
    if (!(await confirm({ title: `Delete "${selected.name}" permanently?` }))) return
    const id = selected.id
    setSelectedId(null)
    await db.models.delete(id)
  }

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Models</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 px-1 py-1 rounded-sm cursor-pointer hover:bg-(--color-panel-3)">
            <Checkbox
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
            />
            <span className="text-sm">Show archived</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3">
        <aside className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 max-h-[80vh] overflow-y-auto">
          {!loaded ? null : visible.length === 0 ? (
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
                    {p.sessions.length === 0 || p.sessions.length === SESSIONS.length
                      ? 'any session'
                      : p.sessions.join(', ')}{' '}
                    · {p.groups.reduce((n, g) => n + g.rules.length, 0)} rules
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        {!loaded ? null : selected ? (
          <ModelEditor
            key={selected.id}
            model={selected}
            onSave={save}
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
  onSave: (patch: Partial<Model>) => void
  onDelete: () => void
}
function ModelEditor({ model, onSave, onDelete }: ModelEditorProps) {
  const confirm = useConfirm()
  const [name, setName] = useState(model.name)
  const [description, setDescription] = useState(model.description)
  const [groups, setGroups] = useState<ModelRuleGroup[]>(model.groups)
  const [sessions, setSessions] = useState<Session[]>(model.sessions)
  const [archived, setArchived] = useState(model.archived)
  const descriptionRef = useAutosizeTextarea(description)

  // The editor holds a working draft locally — nothing persists until the
  // user clicks Save. The parent passes `key={selected.id}`, so switching
  // to a different model unmounts this component and re-seeds the draft
  // from props. Group/rule additions and deletions therefore live in this
  // state only and don't need confirmation prompts.
  const isDirty = useMemo(
    () =>
      name !== model.name ||
      description !== model.description ||
      archived !== model.archived ||
      sessions.length !== model.sessions.length ||
      sessions.some((s, i) => s !== model.sessions[i]) ||
      JSON.stringify(groups) !== JSON.stringify(model.groups),
    [name, description, archived, sessions, groups, model],
  )

  function toggleSession(s: Session, on: boolean) {
    const set = new Set(sessions)
    if (on) set.add(s)
    else set.delete(s)
    // Preserve canonical session order so `pre, am, lunch` reads naturally
    // regardless of click order.
    setSessions(SESSIONS.filter(x => set.has(x)))
  }

  function addRule(groupId: string) {
    setGroups(
      groups.map(g =>
        g.id === groupId ? { ...g, rules: [...g.rules, ''] } : g,
      ),
    )
  }
  function setRule(groupId: string, idx: number, text: string) {
    setGroups(
      groups.map(g =>
        g.id === groupId
          ? { ...g, rules: g.rules.map((r, i) => (i === idx ? text : r)) }
          : g,
      ),
    )
  }
  function deleteRule(groupId: string, idx: number) {
    setGroups(
      groups.map(g =>
        g.id === groupId
          ? { ...g, rules: g.rules.filter((_, i) => i !== idx) }
          : g,
      ),
    )
  }
  function addGroup() {
    setGroups([...groups, { id: newId(), name: 'New group', rules: [] }])
  }
  function setGroupName(groupId: string, text: string) {
    setGroups(groups.map(g => (g.id === groupId ? { ...g, name: text } : g)))
  }
  function deleteGroup(groupId: string) {
    setGroups(groups.filter(g => g.id !== groupId))
  }

  async function handleSave() {
    if (!isDirty) return
    const usageCount = await db.trades
      .filter(t => t.model_id === model.id)
      .count()
    if (usageCount > 0) {
      const ok = await confirm({
        title: 'This model is already in use',
        description: `${usageCount} trade${usageCount === 1 ? '' : 's'} reference this model. Modifying it will affect how those trades are displayed.`,
        confirmLabel: 'Save anyway',
        destructive: false,
      })
      if (!ok) return
    }
    onSave({ name, description, sessions, groups, archived })
  }

  return (
    <div className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Model name"
          className="flex-1 bg-transparent border-0 outline-none text-lg font-medium"
        />
        <button type="button" onClick={handleSave} className={NEUTRAL_BTN_CLASS}>
          <Save className="size-4" /> Save
        </button>
        <button
          type="button"
          onClick={() => setArchived(a => !a)}
          className={NEUTRAL_BTN_CLASS}
        >
          {archived ? (
            <ArchiveRestore className="size-4" />
          ) : (
            <Archive className="size-4" />
          )}
          {archived ? 'Unarchive' : 'Archive'}
        </button>
        <button type="button" onClick={onDelete} className={DELETE_BTN_CLASS}>
          <Trash2 className="size-4" /> Delete
        </button>
      </div>

      <textarea
        ref={descriptionRef}
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Describe the setup, market conditions, when to use it…"
        className={cn(inputClass, 'w-full min-h-[95px] resize-none overflow-hidden')}
      />

      <div className="flex flex-col items-start gap-2">
        <span className="text-xs text-(--color-text-dim)">Sessions</span>
        {/* Same visual track as `Pills`, but each item is independently
            toggleable so multiple sessions can be active. No "All" option
            here — leaving every pill off means "any session" implicitly. */}
        <div className="inline-flex gap-0.5 rounded-(--radius) bg-(--color-bg) p-0.5">
          {SESSIONS.map(s => {
            const active = sessions.includes(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSession(s, !active)}
                aria-pressed={active}
                style={
                  active
                    ? { backgroundColor: SESSION_BG[s], color: SESSION_FG[s] }
                    : undefined
                }
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[6px] cursor-pointer transition-colors whitespace-nowrap px-2.5 py-1 text-sm',
                  active
                    ? 'shadow-(--shadow-xs)'
                    : 'text-(--color-text-dim) hover:text-(--color-text)',
                )}
              >
                {s}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-3">
        {groups.map(g => (
          <div
            key={g.id}
            className={insetTileClass}
          >
            <div className="flex items-center justify-between mb-2">
              <input
                value={g.name}
                onChange={e => setGroupName(g.id, e.target.value)}
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
