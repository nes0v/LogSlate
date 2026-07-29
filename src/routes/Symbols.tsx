import { memo, useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Info, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import {
  countTradesUsingSymbol,
  createSymbol,
  deleteSymbol,
  listSymbols,
  reorderSymbols,
  updateSymbol,
} from '@/db/queries'
import type { TradingSymbol, TradingSymbolDraft } from '@/db/types'
import { useActiveAccountId } from '@/lib/active-account'
import { useConfirm } from '@/components/ConfirmDialog'
import { Field, inputClass } from '@/components/form/Field'
import { NumberInput } from '@/components/form/NumberInput'
import { BTN_ACCENT, BTN_ACTION, BTN_BASE, BTN_DELETE } from '@/components/form/buttonClass'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { SORTABLE_ROW_GAP_CLASS, useSortableReorder } from '@/lib/use-sortable-reorder'
import { cn } from '@/lib/utils'

const BLANK_DRAFT: TradingSymbolDraft = {
  name: 'New symbol',
  description: '',
  point_value: 1,
  tick_size: 0.25,
  fee_per_side: 0,
  scratch_handles: 0,
  draft: false,
}

export function SymbolsRoute() {
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
  // Undefined until Dexie resolves so the empty-state placeholder doesn't flash.
  const symbols = useLiveQuery(() => listSymbols(accountId), [accountId])
  const loaded = symbols !== undefined
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { visible, isActiveDrag, draggingId, rowProps } = useSortableReorder({
    items: symbols,
    onReorder: reorderSymbols,
    onSelect: setSelectedId,
  })

  // Drop the selection when the account changes so the editor can't briefly
  // show the previous account's symbol. Render-phase reset.
  const [prevAccount, setPrevAccount] = useState(accountId)
  if (prevAccount !== accountId) {
    setPrevAccount(accountId)
    setSelectedId(null)
  }

  const selected = useMemo(() => {
    if (selectedId) {
      const s = visible.find(x => x.id === selectedId)
      if (s) return s
    }
    return visible[0] ?? null
  }, [visible, selectedId])

  async function createNew() {
    // Slot the new row below every existing one. Persist a dense order with the
    // new id last rather than a bare `maxSort+1`: migrated symbols are sort-less
    // (they sort to the bottom), so a plain increment would jump the new row
    // above them. Reordering the current display order + the new row backfills
    // `sort` on everything and keeps the newcomer at the bottom.
    const rec = await createSymbol({ ...BLANK_DRAFT }, accountId)
    await reorderSymbols([...visible.map(s => s.id), rec.id])
    setSelectedId(rec.id)
  }

  // Stabilised so the memoised editor doesn't re-render on every drag move.
  const save = useCallback(
    async (patch: Partial<TradingSymbolDraft>) => {
      if (!selected) return
      await updateSymbol(selected.id, patch)
    },
    [selected],
  )
  const remove = useCallback(async () => {
    if (!selected) return
    const inUse = await countTradesUsingSymbol(accountId, selected.id)
    const extra =
      inUse > 0
        ? ` ${inUse} logged trade${inUse === 1 ? '' : 's'} keep the values they were logged with.`
        : ''
    if (!(await confirm({ title: `Delete "${selected.name}"?${extra}` }))) return
    const id = selected.id
    setSelectedId(null)
    await deleteSymbol(id)
  }, [selected, confirm, accountId])

  return (
    <div className="pt-1 space-y-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="h-8 flex items-center text-lg font-semibold">Symbols</h1>
        <button type="button" onClick={createNew} className={BTN_ACCENT}>
          <Plus className="size-4" /> New symbol
        </button>
      </div>

      {!loaded ? null : visible.length === 0 ? (
        <div className="text-sm text-(--color-text-dim) text-center py-12 border border-dashed border-(--color-border) rounded-(--radius)">
          No symbols yet — add one so you can log trades.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3">
          <aside className="bg-(--color-panel) rounded-(--radius) p-3 max-h-[80vh] overflow-y-auto">
            <div className={SORTABLE_ROW_GAP_CLASS}>
              {visible.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  {...rowProps(s.id, i)}
                  className={cn(
                    'block w-full text-left p-3 rounded-sm text-sm select-none transition-colors duration-300 ease-out',
                    selected?.id === s.id
                      ? 'bg-(--color-panel-3) text-(--color-text)'
                      : 'bg-(--color-panel-2) text-(--color-text-dim) hover:bg-(--color-panel-3) hover:text-(--color-text)',
                    draggingId === s.id && isActiveDrag && 'shadow-(--shadow-drop-sm)',
                  )}
                >
                  <div className="truncate flex items-center justify-between font-mono">
                    <span>{s.name}</span>
                    {s.draft && (
                      <span className="text-xs uppercase tracking-wider text-(--color-text-dim) font-sans">
                        draft
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-(--color-text-dim) truncate">
                    ${s.point_value}/pt · {s.fee_per_side.toFixed(2)}/side
                  </div>
                </button>
              ))}
            </div>
          </aside>
          {selected && <SymbolEditor key={selected.id} symbol={selected} onSave={save} onDelete={remove} />}
        </div>
      )}
    </div>
  )
}

interface SymbolEditorProps {
  symbol: TradingSymbol
  onSave: (patch: Partial<TradingSymbolDraft>) => void
  onDelete: () => void
}

function SymbolEditorImpl({ symbol, onSave, onDelete }: SymbolEditorProps) {
  const accountId = useActiveAccountId()
  const confirm = useConfirm()
  const [name, setName] = useState(symbol.name)
  // Normalise a legacy `undefined` description to '' so clearing the field
  // returns to the initial state (else `'' !== undefined` keeps it dirty).
  const [description, setDescription] = useState(symbol.description ?? '')
  const [pointValue, setPointValue] = useState<number | null>(symbol.point_value)
  const [tickSize, setTickSize] = useState<number | null>(symbol.tick_size)
  const [feePerSide, setFeePerSide] = useState<number | null>(symbol.fee_per_side)
  const [scratch, setScratch] = useState<number | null>(symbol.scratch_handles)
  const [draft, setDraft] = useState(symbol.draft)
  const descriptionRef = useAutosizeTextarea()

  const isDirty =
    name !== symbol.name ||
    description !== (symbol.description ?? '') ||
    pointValue !== symbol.point_value ||
    tickSize !== symbol.tick_size ||
    feePerSide !== symbol.fee_per_side ||
    scratch !== symbol.scratch_handles ||
    draft !== symbol.draft

  const valid =
    name.trim().length > 0 &&
    pointValue != null && pointValue > 0 &&
    tickSize != null && tickSize > 0 &&
    feePerSide != null && feePerSide >= 0 &&
    scratch != null && scratch >= 0

  async function handleSave() {
    if (!isDirty || !valid) return
    // Fetch the count fresh at save time — a live-query default of 0 could let a
    // fast open-then-save slip past the "in use" warning before it resolved.
    const inUse = await countTradesUsingSymbol(accountId, symbol.id)
    if (inUse > 0) {
      const ok = await confirm({
        title: 'This symbol is already in use',
        description: `${inUse} trade${inUse === 1 ? '' : 's'} were logged on this symbol. Editing it only affects new trades — those already logged keep the values they were entered with.`,
        confirmLabel: 'Save anyway',
        destructive: false,
      })
      if (!ok) return
    }
    onSave({
      name: name.trim(),
      description,
      point_value: pointValue!,
      tick_size: tickSize!,
      fee_per_side: feePerSide!,
      scratch_handles: scratch!,
      draft,
    })
  }

  return (
    <div className="bg-(--color-panel) rounded-(--radius) p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Symbol name"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-lg font-medium font-mono"
        />
        <button
          type="button"
          onClick={handleSave}
          className={cn(
            `${BTN_BASE} border transition-colors`,
            isDirty && valid
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
          {draft ? <Check className="size-4" /> : <Pencil className="size-4" />}
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
        placeholder="Notes about this instrument (exchange, hours, quirks…)"
        className={cn(inputClass, 'w-full min-h-[95px] resize-none overflow-hidden')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Point value ($ / point)">
          <NumberInput value={pointValue} onChange={setPointValue} className={inputClass} />
        </Field>
        <Field label="Tick size (min increment)">
          <NumberInput value={tickSize} onChange={setTickSize} className={inputClass} />
        </Field>
        <Field label="Fee per side ($ / contract)">
          <NumberInput value={feePerSide} onChange={setFeePerSide} className={inputClass} />
        </Field>
        <Field label="Scratch threshold (points)">
          <NumberInput value={scratch} onChange={setScratch} className={inputClass} />
        </Field>
      </div>

      <div className="text-xs text-(--color-text-dim) space-y-3 pt-2">
        <div className="flex gap-2">
          <Info className="size-4 shrink-0 mt-px text-(--color-text-faint)" />
          <p>
            Editing a symbol only affects new trades. Every past trade keeps the
            fee, point value and tick size it was entered with — they stay frozen
            so your history never shifts.
          </p>
        </div>
        <div className="rounded-(--radius) bg-(--color-panel-2) p-3 space-y-1">
          <p className="text-(--color-text-faint)">
            To apply the new values to an existing trade:
          </p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Save your change here.</li>
            <li>Open that trade, switch its symbol to a different one, and Save.</li>
            <li>Reload the page.</li>
            <li>Switch its symbol back, and Save.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

const SymbolEditor = memo(SymbolEditorImpl)
