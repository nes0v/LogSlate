import { useMemo, useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2 } from 'lucide-react'
import { detectSession, emptyForm, formToDraft, tradeFormSchema, type TradeFormValues } from '@/lib/form-schema'
import { SESSION_BADGE, SESSION_BADGE_CLASS } from '@/lib/session-badge'
import { db } from '@/db/schema'
import { useActiveAccountId } from '@/lib/active-account'
import { EMOTIONS, type Emotion, type TradeDraft } from '@/db/types'
import { Pills } from '@/components/form/Pills'
import { StarRating } from '@/components/form/StarRating'
import { RATING_TO_STARS, STARS_TO_RATING } from '@/lib/rating'
import { Field, inputClass, insetTileClass } from '@/components/form/Field'
import { NumberInput } from '@/components/form/NumberInput'
import { QtyInput } from '@/components/form/QtyInput'
import { Select } from '@/components/form/Select'
import { Checkbox } from '@/components/form/Checkbox'
import { ScreenshotField } from '@/components/ScreenshotField'
import { computeAhpc, computeNetPnl } from '@/lib/trade-math'
import { formatUsd } from '@/lib/money'
import { useAutosizeTextarea } from '@/lib/use-autosize-textarea'
import { useScreenshotUrls } from '@/lib/use-screenshot-urls'
import { cn, mergeRefs } from '@/lib/utils'

const SYMBOLS = [
  { value: 'NQ', label: 'NQ' },
  { value: 'ES', label: 'ES' },
] as const
const CONTRACT_TYPES = [
  { value: 'micro', label: 'micro' },
  { value: 'mini', label: 'mini' },
] as const
const EXECUTION_KINDS = [
  { value: 'buy', label: 'buy' },
  { value: 'sell', label: 'sell' },
] as const
const ORDER_TYPE_OPTIONS = [
  { value: 'limit', label: 'limit' },
  { value: 'market', label: 'market' },
] as const

interface TradeFormProps {
  initialValues?: TradeFormValues
  initialDate: string // YYYY-MM-DD
  onSubmit: (draft: TradeDraft) => Promise<void> | void
  onCancel: () => void
  submitLabel?: string
  /** Resolves the trade's 1-based ordinal within its day when an upload
   *  happens. Called lazily so the count reflects the DB at upload time.
   */
  getTradeOrdinal: () => Promise<number> | number
  /** Edit flow hooks this to persist the screenshot ref to the trade record
   *  the moment it changes, so navigating away without clicking Save doesn't
   *  orphan the uploaded image. Omitted for new-trade flow (no record yet).
   */
  onScreenshotPersist?: (ref: string | null) => Promise<void> | void
}

export function TradeForm({
  initialValues,
  initialDate,
  onSubmit,
  onCancel,
  submitLabel = 'Save trade',
  getTradeOrdinal,
  onScreenshotPersist,
}: TradeFormProps) {
  const accountId = useActiveAccountId()
  // No default — the form's right column waits on the model list so the
  // checklist (which only renders when an existing trade has a `model_id`
  // matching a live model) doesn't pop in late and shove the setup /
  // mistake tag rows downward.
  const models = useLiveQuery(
    async () => {
      const rows = await db.models.where('account_id').equals(accountId).toArray()
      return rows.filter(m => !m.archived)
    },
    [accountId],
  )
  // Pre-resolve the initial screenshot so the thumb paints in its final
  // state (image or "Couldn't load" panel) instead of flashing the
  // "loading…" placeholder. Captured in state so subsequent uploads
  // mid-edit don't re-gate the form.
  const [initialScreenshot] = useState(initialValues?.screenshot ?? null)
  const initialScreenshotRefs = useMemo(
    () => (initialScreenshot ? [initialScreenshot] : []),
    [initialScreenshot],
  )
  const {
    loaded: initialScreenshotResolved,
    resolved: screenshotResolutions,
  } = useScreenshotUrls(initialScreenshotRefs)

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<TradeFormValues>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: initialValues ?? emptyForm(initialDate),
    mode: 'onSubmit',
    reValidateMode: 'onSubmit',
  })

  const executions = useFieldArray({ control, name: 'executions' })
  const values = useWatch({ control }) as TradeFormValues
  const ideaRef = useAutosizeTextarea(values.idea)
  const notesRef = useAutosizeTextarea(values.notes)
  const ideaReg = register('idea')
  const notesReg = register('notes')
  const activeModel = useMemo(
    () => (models ?? []).find(m => m.id === values.model_id) ?? null,
    [models, values.model_id],
  )

  async function submit(v: TradeFormValues) {
    await onSubmit(formToDraft(v))
  }

  // Default a new row's kind to whichever is currently under-represented;
  // keeps scaling flows natural (add buys to enter, then sells to exit).
  function addExecution() {
    const current = values.executions ?? []
    const buys = current.filter(e => e?.kind === 'buy').length
    const sells = current.filter(e => e?.kind === 'sell').length
    executions.append({
      kind: buys <= sells ? 'buy' : 'sell',
      order_type: 'limit',
      price: null,
      time: '',
      contracts: 1,
    })
  }

  // Gate the entire form on `models` having resolved AND the initial
  // screenshot (if any) having resolved. The right column's
  // ModelRuleChecklist depends on which model is selected, and we want
  // the screenshot to render in its final state on first paint instead
  // of flashing the "loading…" placeholder.
  if (models === undefined || !initialScreenshotResolved) return null

  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className="space-y-3">
        <div className="grid lg:grid-cols-2 gap-3 items-start">
          <div className="space-y-3">
            <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-3">
          <div className="flex flex-wrap items-start gap-3">
            <Field label="Symbol" error={errors.symbol?.message}>
              <Controller
                control={control}
                name="symbol"
                render={({ field }) => <Pills value={field.value} onChange={field.onChange} options={SYMBOLS} />}
              />
            </Field>
            <Field label="Contract" error={errors.contract_type?.message}>
              <Controller
                control={control}
                name="contract_type"
                render={({ field }) => <Pills value={field.value} onChange={field.onChange} options={CONTRACT_TYPES} />}
              />
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
          <Field label="Idea" error={errors.idea?.message}>
            <textarea
              className={cn(inputClass, 'min-h-[95px] resize-none overflow-hidden')}
              placeholder="Trade thesis, setup, context…"
              {...ideaReg}
              ref={mergeRefs(ideaReg.ref, ideaRef)}
            />
          </Field>

          <div className="space-y-2">
            <div className="text-xs text-(--color-text-dim)">Executions</div>
            {errors.executions && 'message' in errors.executions && errors.executions.message && (
              <div className="text-xs text-(--color-loss)">{String(errors.executions.message)}</div>
            )}
            {Array.isArray(errors.executions) && errors.executions
              .filter(Boolean)
              .flatMap(e => Object.values(e ?? {}).map(v => (v as { message?: string }).message))
              .filter(Boolean)
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
                    value={field.value ?? null}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
            <Field label="Buildup ($)" error={errors.buildup?.message}>
              <Controller
                control={control}
                name="buildup"
                render={({ field }) => (
                  <NumberInput
                    className={inputClass}
                    value={field.value ?? null}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
          </div>

          <Field label="Screenshot">
            <ScreenshotField
              value={values.screenshot ?? null}
              onChange={ref => {
                setValue('screenshot', ref, { shouldDirty: true })
                if (onScreenshotPersist) void onScreenshotPersist(ref)
              }}
              date={values.date}
              getFilenameSuffix={async () => `trade-${await getTradeOrdinal()}`}
              prefetched={
                values.screenshot
                  ? screenshotResolutions.get(values.screenshot)
                  : undefined
              }
            />
          </Field>
            </section>

            {/* Buttons live inside the left column on lg+ so growing the
                Notes textarea (right column) doesn't push them down. */}
            <div className="hidden lg:flex items-center gap-2">
              <ActionButtons
                isSubmitting={isSubmitting}
                submitLabel={submitLabel}
                onCancel={onCancel}
              />
            </div>
          </div>

          <div className="space-y-3">
            <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3 space-y-3">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Setup tags">
              <Controller
                control={control}
                name="setup_tags"
                render={({ field }) => (
                  <TagInput value={field.value ?? []} onChange={field.onChange} tone="neutral" />
                )}
              />
            </Field>
            <Field label="Mistake tags">
              <Controller
                control={control}
                name="mistake_tags"
                render={({ field }) => (
                  <TagInput value={field.value ?? []} onChange={field.onChange} tone="loss" />
                )}
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              className={cn(inputClass, 'min-h-[95px] resize-none overflow-hidden')}
              placeholder="What did I learn? What would I do differently?"
              {...notesReg}
              ref={mergeRefs(notesReg.ref, notesRef)}
            />
          </Field>
            </section>
            <LiveStatsSection control={control} />
          </div>

          {/* On smaller screens the grid collapses to a single column; the
              buttons go last so they appear after the right column. */}
          <div className="flex lg:hidden items-center gap-2">
            <ActionButtons
              isSubmitting={isSubmitting}
              submitLabel={submitLabel}
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
  submitLabel: string
  onCancel: () => void
}
function ActionButtons({ isSubmitting, submitLabel, onCancel }: ActionButtonsProps) {
  return (
    <>
      <button
        type="submit"
        disabled={isSubmitting}
        className="px-4 py-1.5 text-sm rounded-(--radius) bg-(--color-accent) text-(--color-accent-fg) hover:opacity-90 disabled:opacity-50"
      >
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-1.5 text-sm rounded-(--radius) border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
      >
        Cancel
      </button>
    </>
  )
}

// Subscribes only to the four fields it needs; idea/notes/tag keystrokes
// don't recompute the stats.
function LiveStatsSection({ control }: { control: Control<TradeFormValues> }) {
  const [executions, symbol, contract_type, stop_loss] = useWatch({
    control,
    name: ['executions', 'symbol', 'contract_type', 'stop_loss'],
  })
  const stats = useMemo(() => {
    const execs = (executions ?? [])
      .filter(e => e && e.price != null && e.contracts != null)
      .map(e => ({
        kind: e.kind,
        price: e.price as number,
        time: '',
        contracts: e.contracts as number,
      }))
    const ahpc = computeAhpc({ executions: execs })
    const pnl =
      symbol && contract_type
        ? computeNetPnl({ executions: execs, symbol, contract_type })
        : null
    const rr = stop_loss && stop_loss > 0 && pnl !== null ? pnl / stop_loss : null
    return { ahpc, pnl, rr }
  }, [executions, symbol, contract_type, stop_loss])

  const session = useMemo(() => {
    const times = (executions ?? [])
      .map(e => e?.time)
      .filter((t): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
    if (times.length === 0) return null
    const earliest = times.reduce((min, t) => (t < min ? t : min))
    return detectSession(earliest)
  }, [executions])

  return (
    <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-3">
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
  tone?: 'neutral' | 'loss' | 'win'
}
function TagInput({ value, onChange, tone = 'neutral' }: TagInputProps) {
  const [draft, setDraft] = useState('')
  function commit(text: string) {
    const t = text.trim()
    if (!t || value.includes(t)) {
      setDraft('')
      return
    }
    onChange([...value, t])
    setDraft('')
  }
  function remove(t: string) {
    onChange(value.filter(v => v !== t))
  }
  return (
    <div className="min-h-8 flex flex-wrap items-center gap-1 bg-(--color-bg) rounded-(--radius) px-2.5 py-1 focus-within:ring-2 focus-within:ring-(--color-accent-soft) transition-colors">
      {value.map(t => (
        <span
          key={t}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs',
            tone === 'loss' && 'bg-(--color-loss)/15 text-(--color-loss)',
            tone === 'win' && 'bg-(--color-win)/15 text-(--color-win)',
            tone === 'neutral' && 'bg-(--color-panel-2) text-(--color-text)',
          )}
        >
          {t}
          <button
            type="button"
            onClick={() => remove(t)}
            className="cursor-pointer text-(--color-text-dim) hover:text-(--color-text)"
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => commit(draft)}
        className="flex-1 min-w-[80px] bg-transparent border-0 outline-none text-sm"
      />
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
  const total = groups.reduce((n, g) => n + g.rules.length, 0)
  if (total === 0) {
    return (
      <div className="text-xs text-(--color-text-dim) italic px-2">
        This model has no rules yet.
      </div>
    )
  }
  return (
    <div className={cn(insetTileClass, 'space-y-2')}>
      <div className="text-xs uppercase tracking-wider text-(--color-text-dim) flex items-center justify-between">
        <span>Rules followed</span>
        <span className="font-mono normal-case">
          {set.size} / {total}
        </span>
      </div>
      {groups.map(g => (
        <div key={g.id} className="space-y-0.5">
          <div className="text-xs text-(--color-text-dim)">{g.name}</div>
          {g.rules.map((r, i) => (
            <label
              key={`${g.id}-${i}`}
              className="flex items-start gap-2 px-1 py-1 rounded-sm hover:bg-(--color-panel-3) cursor-pointer"
            >
              <Checkbox
                checked={set.has(r)}
                onChange={e => toggle(r, e.target.checked)}
                className="mt-0.5"
              />
              <span className={cn('text-sm', set.has(r) && 'text-(--color-text-dim)')}>
                {r}
              </span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}
