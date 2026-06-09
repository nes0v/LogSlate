import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { db } from '@/db/schema'
import { countTradesUsingModel, listModels, reorderModels } from '@/db/queries'
import type { Model, ModelRuleGroup, Session } from '@/db/types'
import { SESSIONS } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { useConfirm } from '@/components/ConfirmDialog'
import { inputClass } from '@/components/form/Field'
import { BTN_ACCENT, BTN_BASE } from '@/components/form/buttonClass'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { SESSION_BG, SESSION_FG } from '@/lib/session-colors'
import { cn } from '@/lib/utils'

function newId(): string {
  return crypto.randomUUID()
}

const ACTION_BTN_BASE =
  `${BTN_BASE} border border-(--color-border) text-(--color-text-dim) transition-colors`
const DELETE_BTN_CLASS = `${ACTION_BTN_BASE} hover:text-(--color-loss)`

const DEFAULT_GROUPS = (): ModelRuleGroup[] => [
  { id: newId(), name: 'Entry', rules: [] },
  { id: newId(), name: 'Exit', rules: [] },
  { id: newId(), name: 'Risk', rules: [] },
]

type DragState = {
  id: string
  fromIdx: number
  startY: number
  currentY: number
  itemHeight: number
  /** Sticky promotion to "real drag" — flips to `true` the first move
   *  past `CLICK_THRESHOLD` and never flips back, so passing the cursor
   *  back over the original position mid-drag doesn't drop the shadow. */
  active: boolean
}

// Pixel movement below which we treat pointerdown→pointerup as a click,
// not a drag. Also gates the `grabbing` cursor so a plain click doesn't
// flicker the cursor visual.
const CLICK_THRESHOLD = 5

// Visible gap between sidebar rows. Must match the Tailwind class on
// the row container — `targetSlot` adds it to row height to compute
// the slot pitch.
const ROW_GAP_PX = 6
const ROW_GAP_CLASS = 'space-y-1.5'

// Slot the dragged row currently occupies, clamped to the list bounds.
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

function targetSlot(d: DragState, listLen: number): number {
  const slots = Math.round((d.currentY - d.startY) / d.itemHeight)
  return Math.max(0, Math.min(listLen - 1, d.fromIdx + slots))
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

  // Locally-applied order for the brief window between a drag commit
  // and the live query refresh. Lets the post-drop frame render rows
  // in their final positions so translateY=0 doesn't visibly snap back
  // through the old order.
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null)

  // Drop the selection (and any in-flight drag order) when the account
  // changes, so the editor can't briefly show the previous account's model.
  // Render-phase reset via the previous-value pattern — no extra commit.
  const [prevAccount, setPrevAccount] = useState(accountId)
  if (prevAccount !== accountId) {
    setPrevAccount(accountId)
    setSelectedId(null)
    setOptimisticIds(null)
  }

  const visible = useMemo(() => {
    const base = models ?? []
    if (!optimisticIds) return base
    const byId = new Map(base.map(m => [m.id, m]))
    const optimisticSet = new Set(optimisticIds)
    const ordered: Model[] = []
    for (const id of optimisticIds) {
      const m = byId.get(id)
      if (m) ordered.push(m)
    }
    // Defensive: append any rows missing from `optimisticIds` (e.g. a
    // model added between commit and live-query refresh).
    for (const m of base) {
      if (!optimisticSet.has(m.id)) ordered.push(m)
    }
    return ordered
  }, [models, optimisticIds])
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
    // Slot the new row below every existing one so it lands at the
    // bottom of the user-controlled order.
    const maxSort = Math.max(0, ...(models ?? []).map(m => m.sort ?? 0))
    const p: Model = {
      id: newId(),
      account_id: accountId,
      name: 'New model',
      description: '',
      sessions: [],
      groups: DEFAULT_GROUPS(),
      draft: false,
      sort: maxSort + 1,
      created_at: ts,
      updated_at: ts,
    }
    await db.models.put(p)
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

  // Pointer-driven sortable. Inspired by @dnd-kit/sortable: measure row
  // geometry once on pointerdown, dragged row's transform follows cursor
  // Y, non-dragged rows shift by ±itemHeight as the live target index
  // sweeps past them.
  const [drag, setDrag] = useState<DragState | null>(null)
  const isDragging = drag !== null
  // True once a drag has crossed the click threshold; sticky for the
  // rest of the drag so swinging the cursor back through the start
  // point doesn't drop the shadow / cursor / select-lock for a frame.
  const isActiveDrag = drag !== null && drag.active

  // Latest values for the pointerup closure (registered once when
  // isDragging flips true; can't capture state that changes mid-drag).
  const dragRef = useRef(drag)
  const visibleRef = useRef(visible)
  const modelsRef = useRef(models)
  useEffect(() => {
    dragRef.current = drag
    visibleRef.current = visible
    modelsRef.current = models
  })

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: PointerEvent) => {
      setDrag(d => {
        if (!d) return null
        const active =
          d.active || Math.abs(e.clientY - d.startY) >= CLICK_THRESHOLD
        return { ...d, currentY: e.clientY, active }
      })
    }
    const onUp = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d) return
      const vis = visibleRef.current
      const all = modelsRef.current
      if (!all) return
      // Click vs drag: a click selects the released row; a drag commits
      // the reorder but leaves the previously selected model active so
      // the editor pane stays put. We use the sticky `active` flag (not
      // the live distance) so a wiggly drag that ends back near the
      // origin still commits — matching the visual cursor/shadow that
      // already followed `active`.
      if (!d.active) {
        setSelectedId(d.id)
        return
      }
      const newIdx = targetSlot(d, vis.length)
      if (newIdx === d.fromIdx) return
      const reorderedVisible = vis.slice()
      const [m] = reorderedVisible.splice(d.fromIdx, 1)
      reorderedVisible.splice(newIdx, 0, m)
      const visibleSet = new Set(vis.map(v => v.id))
      let vi = 0
      const ids = all.map(row =>
        visibleSet.has(row.id) ? reorderedVisible[vi++].id : row.id,
      )
      // Apply locally first so the post-drop render lands items in
      // their final positions. The clear runs in the effect below,
      // gated on the live query catching up — clearing on the Dexie
      // promise can race the live query and flash the old order.
      setOptimisticIds(reorderedVisible.map(v => v.id))
      reorderModels(ids).catch(() => setOptimisticIds(null))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [isDragging])

  // Body cursor + select lock follow `isActiveDrag` (post-threshold)
  // so a plain click doesn't briefly flip the cursor to grabbing.
  useEffect(() => {
    if (!isActiveDrag) return
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isActiveDrag])

  // Clear the optimistic order only once the live query has caught up.
  // The cascading render is the point: we want one frame with optimistic
  // ordering applied, then a second once persisted matches and we drop
  // the override. Deriving this during render would require holding the
  // override forever even after the live query catches up.
  useEffect(() => {
    if (!optimisticIds || !models) return
    const persistedOrder = models.map(p => p.id)
    if (
      persistedOrder.length === optimisticIds.length &&
      persistedOrder.every((id, i) => id === optimisticIds[i])
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOptimisticIds(null)
    }
  }, [models, optimisticIds])

  const dragNewIdx = drag ? targetSlot(drag, visible.length) : -1

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
            <div className={ROW_GAP_CLASS}>
              {visible.map((p, i) => {
                const isDragged = drag?.id === p.id
                let translateY = 0
                if (drag) {
                  if (isDragged) {
                    translateY = drag.currentY - drag.startY
                  } else if (
                    drag.fromIdx < dragNewIdx &&
                    i > drag.fromIdx &&
                    i <= dragNewIdx
                  ) {
                    translateY = -drag.itemHeight
                  } else if (
                    drag.fromIdx > dragNewIdx &&
                    i < drag.fromIdx &&
                    i >= dragNewIdx
                  ) {
                    translateY = drag.itemHeight
                  }
                }
                return (
                  <button
                    key={p.id}
                    type="button"
                    onPointerDown={e => {
                      if (e.button !== 0) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      setDrag({
                        id: p.id,
                        fromIdx: i,
                        startY: e.clientY,
                        currentY: e.clientY,
                        itemHeight: rect.height + ROW_GAP_PX,
                        active: false,
                      })
                    }}
                    style={{
                      transform: `translateY(${translateY}px)`,
                      // Animate only while a drag is active. On drop
                      // every row's natural index AND translateY change
                      // in the same frame — a transition would catch
                      // that transform reset and re-animate it from the
                      // pre-drop displacement, jumping the rows.
                      transition:
                        drag && !isDragged
                          ? 'transform 150ms var(--ease), background-color 300ms var(--ease), color 300ms var(--ease)'
                          : 'background-color 300ms var(--ease), color 300ms var(--ease)',
                      zIndex: isDragged ? 10 : undefined,
                      position: 'relative',
                      cursor: isActiveDrag ? 'grabbing' : undefined,
                      touchAction: 'none',
                    }}
                    className={cn(
                      'block w-full text-left p-3 rounded-sm text-sm select-none transition-colors duration-300 ease-out',
                      selected?.id === p.id
                        ? 'bg-(--color-panel-3) text-(--color-text)'
                        : 'bg-(--color-panel-2) text-(--color-text-dim) hover:bg-(--color-panel-3) hover:text-(--color-text)',
                      isDragged && isActiveDrag && 'shadow-(--shadow-drop-sm)',
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
                      {p.sessions.length === 0 ||
                      p.sessions.length === SESSIONS.length
                        ? 'any session'
                        : p.sessions.join(', ')}{' '}
                      · {p.groups.reduce((n, g) => n + g.rules.length, 0)} rules
                    </div>
                  </button>
                )
              })}
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
            `${BTN_BASE} border transition-colors`,
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
            ACTION_BTN_BASE,
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
