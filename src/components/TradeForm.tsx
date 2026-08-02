import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Controller, useFieldArray, useForm, useWatch, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react'
import { detectSession, emptyForm, formToDraft, tradeFormSchema, type TradeFormValues } from '@/lib/form-schema'
import { SESSION_BADGE, SESSION_BADGE_CLASS } from '@/lib/session-badge'
import { listAllTrades, listModels, listSymbols } from '@/db/queries'
import { useActiveAccountId } from '@/lib/active-account'
import { useAccountQuery } from '@/lib/use-account-query'
import {
  EMOTIONS,
  type Emotion,
  type SymbolSnapshot,
  type TradeDraft,
  type TradingSymbol,
} from '@/db/types'
import { symbolSnapshotOf } from '@/lib/symbols'
import { Pills } from '@/components/form/Pills'
import { StarRating } from '@/components/form/StarRating'
import { RATING_TO_STARS, STARS_TO_RATING } from '@/lib/rating'
import { Field, inputClass } from '@/components/form/Field'
import { RuleCheck } from '@/components/form/RuleCheck'
import { NumberInput } from '@/components/form/NumberInput'
import { QtyInput } from '@/components/form/QtyInput'
import { Select } from '@/components/form/Select'
import { BTN_BASE, BTN_OUTLINED } from '@/components/form/buttonClass'
import { computeOrphanRules } from '@/lib/model-rules'
import { computeAhpc, computeNetPnl } from '@/lib/trade-math'
import { formatDuration } from '@/lib/duration'
import { formatUsd } from '@/lib/money'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { cn, mergeRefs } from '@/lib/utils'

const EXECUTION_KINDS = [
  { value: 'buy', label: 'buy' },
  { value: 'sell', label: 'sell' },
] as const
const ORDER_TYPE_OPTIONS = [
  { value: 'mkt', label: 'mkt' },
  { value: 'lmt', label: 'lmt' },
] as const

// Parses a partial-or-full HH:MM[:SS] wallclock into ms-within-day.
// Used by the live-stats duration calculation; assumes the regex
// `^([01]\d|2[0-3]):[0-5]\d` has already matched.
function timeToMs(t: string): number {
  const [hh, mm, ss = '0'] = t.split(':')
  return ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000
}

interface TradeFormProps {
  initialValues?: TradeFormValues
  initialDate: string // YYYY-MM-DD
  onSubmit: (draft: TradeDraft) => Promise<void> | void
  onCancel: () => void
  /** The editing trade's frozen symbol, if any. Snapshot semantics: its spec
   *  is preserved on save unless the user picks a different symbol. Omitted for
   *  new trades (always snapshot the chosen symbol's current config). */
  original?: { symbol_id: string; symbol_spec: SymbolSnapshot }
}

export function TradeForm({
  initialValues,
  initialDate,
  onSubmit,
  onCancel,
  original,
}: TradeFormProps) {
  const accountId = useActiveAccountId()
  const symbols = useAccountQuery(accountId, () => listSymbols(accountId))
  const symbolsById = useMemo(() => {
    const m = new Map<string, TradingSymbol>()
    for (const s of symbols ?? []) m.set(s.id, s)
    return m
  }, [symbols])
  // Draft symbols stay off the picker (like draft models) so a half-configured
  // symbol can't be logged against. `symbolsById` still holds all of them so an
  // existing trade on a now-draft symbol still resolves its spec.
  const symbolOpts = useMemo(
    () => (symbols ?? []).filter(s => !s.draft).map(s => ({ value: s.id, label: s.name })),
    [symbols],
  )
  // No default — the form's right column waits on the model list so the
  // checklist (which only renders when an existing trade has a `model_id`
  // matching a live model) doesn't pop in late and shove the tags row
  // downward.
  const models = useAccountQuery(accountId, async () => {
    const rows = await listModels(accountId)
    return rows.filter(m => !m.draft)
  })
  // Distinct tags across every trade on this account, used by the Tags
  // input for autocomplete. Sorted by usage count (most-used first) so
  // the user's top recurring tags surface before rare one-offs.
  const tagSuggestions = useAccountQuery(accountId, async () => {
    const trades = await listAllTrades(accountId)
    const counts = new Map<string, number>()
    for (const t of trades) {
      for (const tag of t.setup_tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag)
  })
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    getValues,
    setValue,
    reset,
  } = useForm<TradeFormValues, unknown, z.output<typeof tradeFormSchema>>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: initialValues ?? emptyForm(initialDate),
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
  })

  // Keep a brand-new trade pointed at a valid, pickable symbol: default to the
  // first one so the user isn't forced to choose, and re-select if the current
  // choice stops being valid (the account was switched — symbol_id is
  // account-scoped — or the symbol was deleted/drafted). Leaves a still-valid
  // user choice alone. Edits never run this (their symbol comes from the record).
  const isNewTrade = initialValues === undefined
  useEffect(() => {
    if (!isNewTrade || symbols === undefined) return
    const current = getValues('symbol_id')
    const stillValid = !!current && symbols.some(s => s.id === current && !s.draft)
    if (!stillValid) setValue('symbol_id', symbolOpts[0]?.value ?? null)
  }, [symbols, symbolOpts, isNewTrade, getValues, setValue])

  const executions = useFieldArray({ control, name: 'executions' })
  // Scope the top-level subscription to a single field. The free-text
  // textareas re-render on every keystroke; subscribing to the whole form
  // (`useWatch({ control })`) would re-render the entire shell each time.
  // LiveStatsSection has its own scoped subscription for stats.
  const modelIdValue = useWatch({ control, name: 'model_id' })
  const notesRef = useAutosizeTextarea()
  const notesReg = register('notes')
  const ruleTensionRef = useAutosizeTextarea()
  const ruleTensionReg = register('rule_tension')
  const wouldChangeRef = useAutosizeTextarea()
  const wouldChangeReg = register('would_change')
  const activeModel = useMemo(
    () => (models ?? []).find(m => m.id === modelIdValue) ?? null,
    [models, modelIdValue],
  )

  async function submit(v: TradeFormValues) {
    // Freeze the symbol's economics onto the trade (see resolveSymbolSpec).
    const spec = resolveSymbolSpec(original, v.symbol_id as string, symbolsById)
    if (!spec) return // selected symbol vanished (deleted mid-edit) — abort save
    await onSubmit(formToDraft(v, spec))
    reset(getValues(), { keepValues: true })
  }

  // Default a new row's kind to whichever is currently under-represented;
  // keeps scaling flows natural (add buys to enter, then sells to exit).
  function addExecution() {
    const current = getValues('executions') ?? []
    const buys = current.filter(e => e?.kind === 'buy').length
    const sells = current.filter(e => e?.kind === 'sell').length
    executions.append({
      kind: buys <= sells ? 'buy' : 'sell',
      order_type: 'mkt',
      price: null,
      time: '',
      contracts: 1,
    })
  }

  // Gate the entire form on `models` + `symbols` having resolved. The right
  // column's ModelRuleChecklist depends on which model is selected, and the
  // Symbol picker needs the account's symbol list.
  if (models === undefined || symbols === undefined) return null

  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className="space-y-3">
        <div className="grid lg:grid-cols-2 gap-3 items-start">
          <div className="space-y-3">
            <section className="bg-(--color-panel) rounded-(--radius) p-3 space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <Field label="Symbol" error={errors.symbol_id?.message}>
              {symbolOpts.length > 0 ? (
                <Controller
                  control={control}
                  name="symbol_id"
                  render={({ field }) => (
                    <Pills value={field.value} onChange={field.onChange} options={symbolOpts} />
                  )}
                />
              ) : (
                <Link to="/symbols" className="inline-flex items-center h-8 text-sm text-(--color-accent) underline">
                  Add a symbol first
                </Link>
              )}
            </Field>
            <Field label="Rating" error={errors.rating?.message}>
              <Controller
                control={control}
                name="rating"
                render={({ field }) => (
                  <StarRating
                    className="h-8"
                    value={field.value ? RATING_TO_STARS[field.value] : 0}
                    onChange={n => field.onChange(STARS_TO_RATING[n - 1])}
                    count={3}
                  />
                )}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              className={cn(inputClass, 'text-(--color-text-dim) min-h-[95px] resize-none overflow-hidden')}
              placeholder="Trade thesis, setup, context…"
              {...notesReg}
              ref={mergeRefs(notesReg.ref, notesRef)}
            />
          </Field>

          <div className="space-y-2">
            <div className="text-xs text-(--color-text-dim)">Executions</div>
            {errors.executions && 'message' in errors.executions && errors.executions.message && (
              <div className="text-xs text-(--color-loss)">{String(errors.executions.message)}</div>
            )}
            {Array.isArray(errors.executions) && errors.executions
              // Prefix each message with its row so a multi-execution trade
              // points the user at the offending row instead of a bare
              // "time must be HH:MM" with no location.
              .flatMap((e, idx) =>
                Object.values(e ?? {})
                  .map(v => (v as { message?: string }).message)
                  .filter(Boolean)
                  .map(msg => `Row ${idx + 1}: ${msg}`),
              )
              .slice(0, 3)
              .map((msg, i) => (
                <div key={i} className="text-xs text-(--color-loss)">{msg}</div>
              ))}
            <div className="space-y-2">
              {executions.fields.map((item, i) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_70px_24px] gap-2 items-center"
                >
                  <Controller
                    control={control}
                    name={`executions.${i}.kind`}
                    render={({ field }) => (
                      <Pills value={field.value} onChange={field.onChange} options={EXECUTION_KINDS} />
                    )}
                  />
                  <Controller
                    control={control}
                    name={`executions.${i}.order_type`}
                    render={({ field }) => (
                      <Pills value={field.value} onChange={field.onChange} options={ORDER_TYPE_OPTIONS} />
                    )}
                  />
                  <Controller
                    control={control}
                    name={`executions.${i}.price`}
                    render={({ field }) => (
                      <NumberInput
                        placeholder="Price"
                        className={inputClass}
                        value={field.value ?? null}
                        onChange={field.onChange}
                        decimals={2}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name={`executions.${i}.time`}
                    render={({ field }) => (
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="hh:mm:ss"
                        maxLength={8}
                        className={cn(inputClass, 'font-mono w-full min-w-0')}
                        value={field.value ?? ''}
                        onChange={e => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
                          let formatted = digits
                          if (digits.length > 4) {
                            formatted =
                              digits.slice(0, 2) +
                              ':' +
                              digits.slice(2, 4) +
                              ':' +
                              digits.slice(4)
                          } else if (digits.length > 2) {
                            formatted = digits.slice(0, 2) + ':' + digits.slice(2)
                          }
                          field.onChange(formatted)
                        }}
                        onBlur={() => {
                          // Alt-tabbing to another window blurs the input even
                          // though focus stays on it within the page. Skip
                          // padding on a window blur so a half-typed time isn't
                          // committed mid-entry; only normalize on a genuine
                          // in-app blur (document still focused).
                          if (!document.hasFocus()) return
                          // Pad partial input to canonical HH:MM:SS so the form
                          // state matches what gets persisted: "13:30" → "13:30:00",
                          // "13:30:4" → "13:30:40". Padding is right-aligned (a
                          // single second digit reads as tens, like minute notation).
                          const t = field.value ?? ''
                          const m = /^(\d\d):(\d\d)(?::(\d{1,2}))?$/.exec(t)
                          if (m) {
                            const ss = (m[3] ?? '').padEnd(2, '0')
                            field.onChange(`${m[1]}:${m[2]}:${ss}`)
                          }
                          field.onBlur()
                        }}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name={`executions.${i}.contracts`}
                    render={({ field }) => (
                      <QtyInput
                        className="-mr-1"
                        value={field.value ?? 1}
                        onChange={field.onChange}
                      />
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => executions.remove(i)}
                    disabled={executions.fields.length <= 2}
                    aria-label="Remove execution"
                    className="size-8 justify-self-start rounded-(--radius) text-(--color-text-dim) hover:text-(--color-loss) disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addExecution}
              className="inline-flex items-center gap-1 text-xs text-(--color-accent) hover:underline"
            >
              <Plus className="size-3" /> Add execution
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Field label="Stop loss ($)" error={errors.stop_loss?.message}>
              <Controller
                control={control}
                name="stop_loss"
                render={({ field }) => (
                  <NumberInput
                    className={inputClass}
                    decimals={2}
                    value={field.value ?? null}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
            <Field label="Profit target ($)" error={errors.profit_target?.message}>
              <Controller
                control={control}
                name="profit_target"
                render={({ field }) => (
                  <NumberInput
                    className={inputClass}
                    decimals={2}
                    value={field.value ?? null}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
            <Field label="Drawdown ($)" error={errors.drawdown?.message}>
              <Controller
                control={control}
                name="drawdown"
                render={({ field }) => (
                  <NumberInput
                    className={inputClass}
                    decimals={2}
                    value={field.value ?? null}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
            <Field label="Runup ($)" error={errors.runup?.message}>
              <Controller
                control={control}
                name="runup"
                render={({ field }) => (
                  <NumberInput
                    className={inputClass}
                    decimals={2}
                    value={field.value ?? null}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
          </div>

            </section>

            <LiveStatsSection control={control} symbolsById={symbolsById} original={original} />

            {/* Buttons live inside the left column on lg+ so growing the
                Notes textarea (right column) doesn't push them down. */}
            <div className="hidden lg:flex items-center gap-2">
              <ActionButtons
                isSubmitting={isSubmitting}
                isDirty={isDirty}
                onCancel={onCancel}
              />
            </div>
          </div>

          <div className="space-y-3">
            <section className="bg-(--color-panel) rounded-(--radius) p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model">
              <Controller
                control={control}
                name="model_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? null}
                    onChange={v => field.onChange(v)}
                    options={(models ?? []).map(m => ({ value: m.id, label: m.name }))}
                    ariaLabel="Model"
                  />
                )}
              />
            </Field>
            <Field label="Emotion" error={errors.emotion?.message}>
              <Controller
                control={control}
                name="emotion"
                render={({ field }) => (
                  <Select
                    value={field.value ?? null}
                    onChange={v => field.onChange(v as Emotion | null)}
                    options={EMOTIONS.map(e => ({ value: e, label: e }))}
                    ariaLabel="Emotion"
                  />
                )}
              />
            </Field>
          </div>

          {activeModel && (
            <Controller
              control={control}
              name="model_rules_followed"
              render={({ field }) => (
                <ModelRuleChecklist
                  groups={activeModel.groups}
                  followed={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
          )}

          <Field label="Tags">
            <Controller
              control={control}
              name="setup_tags"
              render={({ field }) => (
                <TagInput
                  value={field.value ?? []}
                  onChange={field.onChange}
                  suggestions={tagSuggestions ?? []}
                  tone="neutral"
                />
              )}
            />
          </Field>

          <Field label="Rule tension">
            <textarea
              className={cn(inputClass, 'text-(--color-text-dim) min-h-[95px] resize-none overflow-hidden')}
              placeholder="Did I consider breaking a rule? Which one, and when?"
              {...ruleTensionReg}
              ref={mergeRefs(ruleTensionReg.ref, ruleTensionRef)}
            />
          </Field>

          <Field label="Would change">
            <textarea
              className={cn(inputClass, 'text-(--color-text-dim) min-h-[95px] resize-none overflow-hidden')}
              placeholder="Taking this same trade again, what would I change?"
              {...wouldChangeReg}
              ref={mergeRefs(wouldChangeReg.ref, wouldChangeRef)}
            />
          </Field>
            </section>
          </div>

          {/* On smaller screens the grid collapses to a single column; the
              buttons go last so they appear after the right column. */}
          <div className="flex lg:hidden items-center gap-2">
            <ActionButtons
              isSubmitting={isSubmitting}
              isDirty={isDirty}
              onCancel={onCancel}
            />
          </div>
        </div>
      </div>
    </form>
  )
}

interface ActionButtonsProps {
  isSubmitting: boolean
  isDirty: boolean
  onCancel: () => void
}
function ActionButtons({ isSubmitting, isDirty, onCancel }: ActionButtonsProps) {
  return (
    <>
      <button
        type="submit"
        disabled={isSubmitting}
        className={cn(
          `${BTN_BASE} border disabled:opacity-50`,
          isDirty
            ? 'bg-(--color-accent) border-(--color-accent) text-(--color-accent-fg) hover:opacity-90'
            : 'border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)',
        )}
      >
        <Save className="size-4" /> Save
      </button>
      <button type="button" onClick={onCancel} className={BTN_OUTLINED}>
        <ArrowLeft className="size-4" /> back
      </button>
    </>
  )
}

// The economics used by both save and the live preview: keep the trade's
// frozen `symbol_spec` while its symbol is unchanged (so editing a symbol's
// fee never retroactively shifts past trades or the preview under the user);
// snapshot the live row only for a new trade or a changed symbol.
function resolveSymbolSpec(
  original: { symbol_id: string; symbol_spec: SymbolSnapshot } | undefined,
  symbolId: string | null | undefined,
  symbolsById: Map<string, TradingSymbol>,
): SymbolSnapshot | undefined {
  if (!symbolId) return undefined
  if (original && original.symbol_id === symbolId) return original.symbol_spec
  const sym = symbolsById.get(symbolId)
  return sym ? symbolSnapshotOf(sym) : undefined
}

// Subscribes only to the four fields it needs; keystrokes in the free-text
// fields (notes, rule tension, would change) and tags don't recompute stats.
function LiveStatsSection({
  control,
  symbolsById,
  original,
}: {
  control: Control<TradeFormValues>
  symbolsById: Map<string, TradingSymbol>
  original?: { symbol_id: string; symbol_spec: SymbolSnapshot }
}) {
  const [executions, symbol_id, stop_loss] = useWatch({
    control,
    name: ['executions', 'symbol_id', 'stop_loss'],
  })
  const stats = useMemo(() => {
    const execs = (executions ?? [])
      .filter(e => e && e.price != null && e.contracts != null)
      .map(e => ({
        kind: e.kind,
        order_type: e.order_type,
        price: e.price as number,
        time: '',
        contracts: e.contracts as number,
      }))
    const ahpc = computeAhpc({ executions: execs })
    const spec = resolveSymbolSpec(original, symbol_id, symbolsById)
    const pnl = spec ? computeNetPnl({ executions: execs, symbol_spec: spec }) : null
    const rr = stop_loss && stop_loss > 0 && pnl !== null ? pnl / stop_loss : null
    return { ahpc, pnl, rr }
  }, [executions, symbol_id, stop_loss, symbolsById, original])

  const { session, durationMs } = useMemo(() => {
    const times = (executions ?? [])
      .map(e => e?.time)
      .filter((t): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d/.test(t))
    if (times.length === 0) return { session: null, durationMs: null }
    let earliest = times[0]
    let latest = times[0]
    for (const t of times) {
      if (t < earliest) earliest = t
      if (t > latest) latest = t
    }
    const duration = earliest === latest ? null : timeToMs(latest) - timeToMs(earliest)
    return { session: detectSession(earliest, latest), durationMs: duration }
  }, [executions])

  return (
    <section className="bg-(--color-panel) rounded-(--radius) p-3">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-2">
          <div className="text-xs text-(--color-text-dim)">Session</div>
          {session ? (
            <span className={cn(SESSION_BADGE_CLASS, SESSION_BADGE[session])}>
              {session}
            </span>
          ) : (
            <div className="text-sm font-mono tabular-nums">—</div>
          )}
        </div>
        <Stat label="Duration" value={formatDuration(durationMs)} />
        <Stat label="AHPC" value={stats.ahpc !== null ? stats.ahpc.toFixed(2) : '—'} />
        <Stat
          label="PNL"
          value={stats.pnl !== null ? formatUsd(stats.pnl) : '—'}
          tone={stats.pnl !== null ? (stats.pnl > 0 ? 'win' : stats.pnl < 0 ? 'loss' : null) : null}
        />
        <Stat label="RR" value={stats.rr !== null ? `${stats.rr.toFixed(2)}x` : '—'} />
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'win' | 'loss' | null
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-xs text-(--color-text-dim)">{label}</div>
      <div
        className={cn(
          'text-sm font-mono tabular-nums',
          tone === 'win' && 'text-(--color-win)',
          tone === 'loss' && 'text-(--color-loss)',
        )}
      >
        {value}
      </div>
    </div>
  )
}

interface TagInputProps {
  value: string[]
  onChange: (v: string[]) => void
  suggestions?: string[]
  tone?: 'neutral' | 'loss' | 'win'
}
function TagInput({
  value,
  onChange,
  suggestions = [],
  tone = 'neutral',
}: TagInputProps) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // Case-insensitive prefix-first match against existing tags (rare
  // duplicates like "Breakout" vs "breakout" are caught by normalising
  // to the suggestion's casing in `commit`).
  const filtered = useMemo(() => {
    const picked = new Set(value.map(v => v.toLowerCase()))
    const pool = suggestions.filter(s => !picked.has(s.toLowerCase()))
    const q = draft.trim().toLowerCase()
    if (!q) return pool.slice(0, 50)
    const starts: string[] = []
    const contains: string[] = []
    for (const s of pool) {
      const ls = s.toLowerCase()
      if (ls.startsWith(q)) starts.push(s)
      else if (ls.includes(q)) contains.push(s)
    }
    return [...starts, ...contains].slice(0, 50)
  }, [draft, value, suggestions])

  // Reset the highlight whenever the candidate list changes so the user
  // doesn't end up pointing at a row that scrolled out of view. Done
  // during render via the previous-value pattern (not an effect), so it
  // costs no extra commit and never trips set-state-in-effect.
  const candidateKey = `${draft}\u0000${filtered.length}`
  const [prevCandidateKey, setPrevCandidateKey] = useState(candidateKey)
  if (candidateKey !== prevCandidateKey) {
    setPrevCandidateKey(candidateKey)
    setActiveIdx(-1)
  }

  // Keep the highlighted row visible when arrow-keying past the
  // overflow boundary.
  useEffect(() => {
    if (activeIdx < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  function commit(text: string) {
    const t = text.trim()
    if (!t) {
      setDraft('')
      return
    }
    // Case-insensitive dedupe against already-picked tags, plus
    // casing-normalisation against existing tag library so "BREAKOUT"
    // collapses into the existing "breakout" rather than becoming a
    // near-duplicate.
    const lower = t.toLowerCase()
    if (value.some(v => v.toLowerCase() === lower)) {
      setDraft('')
      return
    }
    const existing = suggestions.find(s => s.toLowerCase() === lower)
    onChange([...value, existing ?? t])
    setDraft('')
  }
  function remove(t: string) {
    onChange(value.filter(v => v !== t))
  }

  const showDropdown = focused && filtered.length > 0

  return (
    <div className="relative">
      <div
        className={cn(
          'min-h-8 flex flex-wrap items-center gap-1 bg-(--color-bg) rounded-(--radius) py-1 pr-2.5 focus-within:ring-2 focus-within:ring-(--color-accent-soft)',
          value.length > 0 ? 'pl-1' : 'pl-2.5',
        )}
      >
        {value.map(t => (
          <span
            key={t}
            className={cn(
              'inline-flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-[4px] text-xs',
              tone === 'loss' && 'bg-(--color-loss)/15 text-(--color-loss)',
              tone === 'win' && 'bg-(--color-win)/15 text-(--color-win)',
              tone === 'neutral' && 'bg-(--color-panel-2) text-(--color-text)',
            )}
          >
            {t}
            <button
              type="button"
              onClick={() => remove(t)}
              className="inline-flex items-center justify-center cursor-pointer text-(--color-text-dim) hover:text-(--color-text)"
              aria-label={`Remove tag ${t}`}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Don't auto-commit the draft on blur — clicking Save (or any
            // other field) would otherwise silently add a half-typed
            // fragment as a tag. Tags are added explicitly via Enter /
            // comma / clicking a suggestion.
            setFocused(false)
          }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' && filtered.length > 0) {
              e.preventDefault()
              setActiveIdx(i => (i + 1) % filtered.length)
            } else if (e.key === 'ArrowUp' && filtered.length > 0) {
              e.preventDefault()
              setActiveIdx(i => (i <= 0 ? filtered.length - 1 : i - 1))
            } else if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              if (activeIdx >= 0 && filtered[activeIdx]) {
                commit(filtered[activeIdx])
              } else {
                commit(draft)
              }
            } else if (e.key === 'Escape') {
              if (showDropdown) {
                e.preventDefault()
                setFocused(false)
              }
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          className="flex-1 min-w-[80px] bg-transparent border-0 outline-none text-sm"
        />
      </div>
      {showDropdown && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full mt-1 z-20 max-h-56 overflow-y-auto bg-(--color-panel) border border-(--color-border-strong) rounded-(--radius)"
        >
          {filtered.map((s, i) => (
            <button
              key={s}
              type="button"
              data-idx={i}
              // mousedown fires before the input's blur — preventDefault
              // here keeps focus on the input so the dropdown doesn't
              // collapse out from under the click.
              onMouseDown={e => {
                e.preventDefault()
                commit(s)
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={cn(
                'block w-full text-left px-2.5 py-1.5 text-sm whitespace-nowrap cursor-pointer',
                i === activeIdx
                  ? 'bg-(--color-panel-2) text-(--color-text)'
                  : 'text-(--color-text-dim) hover:bg-(--color-panel-2) hover:text-(--color-text)',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ModelRuleChecklist({
  groups,
  followed,
  onChange,
}: {
  groups: Array<{ id: string; name: string; rules: string[] }>
  followed: string[]
  onChange: (v: string[]) => void
}) {
  const set = useMemo(() => new Set(followed), [followed])
  function toggle(rule: string, on: boolean) {
    if (on) onChange([...new Set([...followed, rule])])
    else onChange(followed.filter(r => r !== rule))
  }
  // Rules the user logged that the model no longer contains (deleted or
  // renamed since the trade was saved). Surfaced as a trailing group so
  // the user can uncheck — once unchecked + saved, the string drops off
  // `model_rules_followed` and won't reappear.
  const orphans = useMemo(() => computeOrphanRules(groups, followed), [groups, followed])
  const total = groups.reduce((n, g) => n + g.rules.length, 0)
  if (total === 0 && orphans.length === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) italic px-2">
        This model has no rules yet.
      </div>
    )
  }
  return (
    <div className="bg-(--color-panel-2) rounded-(--radius) p-3 space-y-2">
      {groups.map(g => (
        <div key={g.id} className="space-y-0.5">
          <div className="text-xs text-(--color-text-dim)">{g.name}</div>
          {g.rules.map((r, i) => (
            <RuleCheck
              key={`${g.id}-${i}`}
              checked={set.has(r)}
              onChange={ok => toggle(r, ok)}
              label={r}
            />
          ))}
        </div>
      ))}
      {orphans.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-xs text-(--color-text-dim) italic">Removed from model</div>
          {orphans.map((r, i) => (
            <RuleCheck
              key={`orphan-${i}`}
              checked
              onChange={ok => toggle(r, ok)}
              label={r}
            />
          ))}
        </div>
      )}
    </div>
  )
}
