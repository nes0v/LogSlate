import { memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { db } from '@/db/schema'
import { countTradesUsingModel, listModels, reorderModels } from '@/db/queries'
import type { Model, ModelRuleGroup, Session } from '@/db/types'
import { SESSIONS } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClass } from '@/components/form/Field'
import { BTN_ACCENT, BTN_ACTION, BTN_BASE, BTN_DELETE } from '@/components/form/buttonClass'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { SORTABLE_ROW_GAP_CLASS, useSortableReorder } from '@/lib/use-sortable-reorder'
import { SESSION_BG, SESSION_FG } from '@/lib/session-colors'
import { cn } from '@/lib/utils'

function newId(): string {
  return crypto.randomUUID()
}

const DEFAULT_GROUPS = (): ModelRuleGroup[] => [
  { id: newId(), name: 'Entry', rules: [] },
  { id: newId(), name: 'Exit', rules: [] },
  { id: newId(), name: 'Risk', rules: [] },
]

// Structural equality for the rule-group tree. Used to compute the
// dirty-state of the model editor on every keystroke — `JSON.stringify`
// is the obvious answer but it serialises the whole tree on every memo
// run; walking it directly avoids the allocation.
function sameGroups(a: ModelRuleGroup[], b: ModelRuleGroup[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ga = a[i]
    const gb = b[i]
    if (ga.id !== gb.id || ga.name !== gb.name) return false
    if (ga.rules.length !== gb.rules.length) return false
    for (let j = 0; j < ga.rules.length; j++) {
      if (ga.rules[j] !== gb.rules[j]) return false
    }
  }
  return true
}

export function ModelsRoute() {
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
  // No default value — `models` is undefined until Dexie resolves so we
  // can suppress the "No models yet" placeholder + empty editor pane on
  // the first paint frame (otherwise the page flickers on navigation).
  const models = useLiveQuery(() => listModels(accountId), [accountId])
  const loaded = models !== undefined
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Draggable sidebar order (shared with the Symbols page).
  const { visible, isActiveDrag, draggingId, rowProps } = useSortableReorder({
    items: models,
    onReorder: reorderModels,
    onSelect: setSelectedId,
  })

  // Drop the selection when the account changes so the editor can't briefly
  // show the previous account's model. Render-phase reset (previous-value
  // pattern) — the hook's optimistic order self-clears when `models` changes.
  const [prevAccount, setPrevAccount] = useState(accountId)
  if (prevAccount !== accountId) {
    setPrevAccount(accountId)
    setSelectedId(null)
  }

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
    // Slot the new row below every existing one. Create it sort-less, then
    // persist a dense order with the new id last: a bare `maxSort+1` would jump
    // above any sort-less rows (which `listModels` sends to the bottom).
    const p: Model = {
      id: newId(),
      account_id: accountId,
      name: 'New model',
      description: '',
      sessions: [],
      groups: DEFAULT_GROUPS(),
      draft: false,
      created_at: ts,
      updated_at: ts,
    }
    await db.models.put(p)
    await reorderModels([...visible.map(m => m.id), p.id])
    setSelectedId(p.id)
  }

  // Callbacks are stabilized so the memoized `ModelEditor` doesn't
  // re-render on every cursor move during a sidebar drag — fresh
  // function references would defeat the memo. They depend on `selected`,
  // which is itself memoized, so identity only flips on selection
  // change. See ModelEditor's `memo()` wrapper at the bottom of the file.
  const save = useCallback(
    async (patch: Partial<Model>) => {
      if (!selected) return
      await db.models.update(selected.id, {
        ...patch,
        updated_at: new Date().toISOString(),
      })
    },
    [selected],
  )

  const remove = useCallback(async () => {
    if (!selected) return
    if (!(await confirm({ title: `Delete "${selected.name}" permanently?` }))) return
    const id = selected.id
    setSelectedId(null)
    await db.models.delete(id)
  }, [selected, confirm])

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Models</h1>
        <button type="button" onClick={createModel} className={BTN_ACCENT}>
          <Plus className="size-4" /> New model
        </button>
      </div>

      {!loaded ? null : visible.length === 0 ? (
        <EmptyPanel>No models yet.</EmptyPanel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3">
          <aside className="bg-(--color-panel) rounded-(--radius) p-3 max-h-[80vh] overflow-y-auto">
            <div className={SORTABLE_ROW_GAP_CLASS}>
              {visible.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  {...rowProps(p.id, i)}
                  className={cn(
                    'block w-full text-left p-3 rounded-sm text-sm select-none',
                    selected?.id === p.id
                      ? 'bg-(--color-panel-3) text-(--color-text)'
                      : 'bg-(--color-panel-2) text-(--color-text-dim) hover:bg-(--color-panel-3) hover:text-(--color-text)',
                    draggingId === p.id && isActiveDrag && 'shadow-(--shadow-drop-sm)',
                  )}
                >
                  <div className="truncate flex items-center justify-between">
                    <span>{p.name}</span>
                    {p.draft && (
                      <span className="text-xs uppercase tracking-wider text-(--color-text-dim)">
                        draft
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
          </aside>
          {selected && (
            <ModelEditor
              key={selected.id}
              model={selected}
              onSave={save}
              onDelete={remove}
            />
          )}
        </div>
      )}
    </div>
  )
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
      {children}
    </div>
  )
}

interface ModelEditorProps {
  model: Model
  onSave: (patch: Partial<Model>) => void
  onDelete: () => void
}
function ModelEditorImpl({ model, onSave, onDelete }: ModelEditorProps) {
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
  const [name, setName] = useState(model.name)
  const [description, setDescription] = useState(model.description)
  const [groups, setGroups] = useState<ModelRuleGroup[]>(model.groups)
  const [sessions, setSessions] = useState<Session[]>(model.sessions)
  const [draft, setDraft] = useState(model.draft)
  const descriptionRef = useAutosizeTextarea()

  // Working draft — only persists on Save. Parent's `key={selected.id}`
  // resets drafts on model switch, so group/rule mutations don't need
  // confirmation prompts.
  const isDirty = useMemo(
    () =>
      name !== model.name ||
      description !== model.description ||
      draft !== model.draft ||
      sessions.length !== model.sessions.length ||
      sessions.some((s, i) => s !== model.sessions[i]) ||
      !sameGroups(groups, model.groups),
    [name, description, draft, sessions, groups, model],
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
    const usageCount = await countTradesUsingModel(accountId, model.id)
    if (usageCount > 0) {
      const ok = await confirm({
        title: 'This model is already in use',
        description: `${usageCount} trade${usageCount === 1 ? '' : 's'} reference this model. Modifying it will affect how those trades are displayed.`,
        confirmLabel: 'Save anyway',
        destructive: false,
      })
      if (!ok) return
    }
    onSave({ name, description, sessions, groups, draft })
  }

  return (
    <div className="bg-(--color-panel) rounded-(--radius) p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Model name"
          className="flex-1 bg-transparent border-0 outline-none text-lg font-medium"
        />
        <button
          type="button"
          onClick={handleSave}
          className={cn(
            `${BTN_BASE} border`,
            isDirty
              ? 'bg-(--color-accent) border-(--color-accent) text-(--color-accent-fg) hover:opacity-90'
              : 'border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)',
          )}
        >
          <Save className="size-4" /> Save
        </button>
        <button
          type="button"
          onClick={() => setDraft(d => !d)}
          className={cn(
            BTN_ACTION,
            draft ? 'hover:text-(--color-win)' : 'hover:text-(--color-warn)',
          )}
        >
          {draft ? (
            <Check className="size-4" />
          ) : (
            <Pencil className="size-4" />
          )}
          {draft ? 'Mark as ready' : 'Mark as draft'}
        </button>
        <button type="button" onClick={onDelete} className={BTN_DELETE}>
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
                  'inline-flex items-center gap-1.5 rounded-[6px] cursor-pointer whitespace-nowrap px-2.5 py-1 text-sm',
                  !active && 'text-(--color-text-dim) hover:text-(--color-text)',
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
            className="bg-(--color-panel-2) rounded-(--radius) p-3"
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

// Memoized so the parent re-rendering on every pointermove during a
// sidebar drag doesn't cascade into the entire form pane. Default
// shallow compare is enough — `model` is a memoized record, `onSave`
// and `onDelete` are useCallback'd in `ModelsRoute`.
const ModelEditor = memo(ModelEditorImpl)
