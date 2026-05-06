import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, Plus, Save, Trash2, X } from 'lucide-react'
import { db } from '@/db/schema'
import { countTradesUsingModel, listModels, reorderModels } from '@/db/queries'
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

type DragState = {
  id: string
  fromIdx: number
  startY: number
  currentY: number
  itemHeight: number
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
  const [showArchived, setShowArchived] = useState(false)

  // Locally-applied order for the brief window between a drag commit
  // and the live query refresh. Lets the post-drop frame render rows
  // in their final positions so translateY=0 doesn't visibly snap back
  // through the old order.
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null)

  const visible = useMemo(() => {
    const base = (models ?? []).filter(p => showArchived || !p.archived)
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
  }, [models, showArchived, optimisticIds])
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
      archived: false,
      sort: maxSort + 1,
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

  // Pointer-driven sortable. Inspired by @dnd-kit/sortable: measure row
  // geometry once on pointerdown, dragged row's transform follows cursor
  // Y, non-dragged rows shift by ±itemHeight as the live target index
  // sweeps past them. Reorders persist over the FULL list — visible
  // rows are spliced into their new order while archived-when-hidden
  // rows keep their slot indices, so toggling Show archived doesn't
  // corrupt the user's chosen layout.
  const [drag, setDrag] = useState<DragState | null>(null)
  const isDragging = drag !== null
  // Distinct from `isDragging` — true only after the pointer has moved
  // past the click threshold, so a plain click doesn't flip the cursor.
  const isActiveDrag =
    drag !== null && Math.abs(drag.currentY - drag.startY) >= CLICK_THRESHOLD

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
      setDrag(d => (d ? { ...d, currentY: e.clientY } : null))
    }
    const onUp = () => {
      const d = dragRef.current
      setDrag(null)
      if (!d) return
      const vis = visibleRef.current
      const all = modelsRef.current
      if (!all) return
      // Tiny pointer movement = treat as a click so pointerdown-up
      // without dragging still selects the row.
      if (Math.abs(d.currentY - d.startY) < CLICK_THRESHOLD) {
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
  useEffect(() => {
    if (!optimisticIds || !models) return
    const persistedOrder = models
      .filter(p => showArchived || !p.archived)
      .map(p => p.id)
    if (
      persistedOrder.length === optimisticIds.length &&
      persistedOrder.every((id, i) => id === optimisticIds[i])
    ) {
      setOptimisticIds(null)
    }
  }, [models, showArchived, optimisticIds])

  const dragNewIdx = drag ? targetSlot(drag, visible.length) : -1

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
                          ? 'transform 150ms var(--ease)'
                          : 'none',
                      zIndex: isDragged ? 10 : undefined,
                      position: 'relative',
                      cursor: isActiveDrag ? 'grabbing' : undefined,
                      touchAction: 'none',
                    }}
                    className={cn(
                      'block w-full text-left p-3 rounded-sm text-sm select-none',
                      selected?.id === p.id
                        ? 'bg-(--color-panel-2) text-(--color-text)'
                        : 'bg-(--color-panel) text-(--color-text-dim) hover:text-(--color-text) hover:bg-(--color-panel-2)',
                      isDragged &&
                        'shadow-(--shadow-md) bg-(--color-panel-2) text-(--color-text)',
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
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
  const [name, setName] = useState(model.name)
  const [description, setDescription] = useState(model.description)
  const [groups, setGroups] = useState<ModelRuleGroup[]>(model.groups)
  const [sessions, setSessions] = useState<Session[]>(model.sessions)
  const [archived, setArchived] = useState(model.archived)
  const descriptionRef = useAutosizeTextarea()

  // Working draft — only persists on Save. Parent's `key={selected.id}`
  // resets drafts on model switch, so group/rule mutations don't need
  // confirmation prompts.
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
        <button
          type="button"
          onClick={handleSave}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-(--radius) transition-colors',
            isDirty
              ? 'bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90'
              : 'border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)',
          )}
        >
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
