import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { emptyForm, formToDraft, tradeFormSchema, type TradeFormValues } from '@/lib/form-schema'
import type { TradeDraft } from '@/db/types'
import { Pills } from '@/components/form/Pills'
import { Field, inputClass } from '@/components/form/Field'
import { NumberInput } from '@/components/form/NumberInput'
import { QtyInput } from '@/components/form/QtyInput'
import { ScreenshotField } from '@/components/ScreenshotField'
import { ReflectionSection } from '@/components/ReflectionSection'
import { cn } from '@/lib/utils'

const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select()

const SYMBOLS = [
  { value: 'NQ', label: 'NQ' },
  { value: 'ES', label: 'ES' },
] as const
const CONTRACT_TYPES = [
  { value: 'micro', label: 'micro' },
  { value: 'mini', label: 'mini' },
] as const
const SESSIONS = [
  { value: 'pre', label: 'pre' },
  { value: 'AM', label: 'AM' },
  { value: 'LT', label: 'LT' },
  { value: 'PM', label: 'PM' },
  { value: 'aft', label: 'aft' },
] as const
const RATINGS = [
  { value: 'excellent', label: 'A' },
  { value: 'good', label: 'B' },
  { value: 'egg', label: 'C' },
] as const
const EXECUTION_KINDS = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
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

  async function submit(v: TradeFormValues) {
    await onSubmit(formToDraft(v))
  }

  // Default a new row's kind to whichever is currently under-represented;
  // keeps scaling flows natural (add buys to enter, then sells to exit).
  function addExecution() {
    const current = values.executions ?? []
    const buys = current.filter(e => e?.kind === 'buy').length
    const sells = current.filter(e => e?.kind === 'sell').length
    executions.append({ kind: buys <= sells ? 'buy' : 'sell', price: null, time: '', contracts: 1 })
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className="space-y-4">
        <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-4 flex flex-wrap items-end gap-4">
          <Field label="Symbol">
            <Controller
              control={control}
              name="symbol"
              render={({ field }) => <Pills value={field.value} onChange={field.onChange} options={SYMBOLS} />}
            />
          </Field>
          <Field label="Contract">
            <Controller
              control={control}
              name="contract_type"
              render={({ field }) => <Pills value={field.value} onChange={field.onChange} options={CONTRACT_TYPES} />}
            />
          </Field>
          <Field label="Session">
            <Controller
              control={control}
              name="session"
              render={({ field }) => <Pills value={field.value} onChange={field.onChange} options={SESSIONS} />}
            />
          </Field>
          <Field label="Rating">
            <Controller
              control={control}
              name="rating"
              render={({ field }) => <Pills value={field.value} onChange={field.onChange} options={RATINGS} />}
            />
          </Field>
        </section>

        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <section className="bg-(--color-panel) rounded-(--radius) shadow-(--shadow-xs) p-4 space-y-4">
          <Field label="Idea" error={errors.idea?.message}>
            <textarea
              className={cn(inputClass, 'min-h-[135px] resize-y')}
              placeholder="Trade thesis, setup, context…"
              {...register('idea')}
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
                  className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_70px_24px] gap-2 items-center"
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
                    name={`executions.${i}.price`}
                    render={({ field }) => (
                      <NumberInput
                        placeholder="Price"
                        className={inputClass}
                        onFocus={selectOnFocus}
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
                        placeholder="hh:mm"
                        maxLength={5}
                        className={cn(inputClass, 'font-mono w-full min-w-0')}
                        onFocus={selectOnFocus}
                        value={field.value ?? ''}
                        onChange={e => {
                          const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                          const formatted =
                            digits.length <= 2 ? digits : digits.slice(0, 2) + ':' + digits.slice(2)
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

          <div className="grid grid-cols-2 gap-4 pt-2">
            <Field label="Stop loss ($)" error={errors.stop_loss?.message}>
              <Controller
                control={control}
                name="stop_loss"
                render={({ field }) => (
                  <NumberInput
                    className={inputClass}
                    onFocus={selectOnFocus}
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
                    onFocus={selectOnFocus}
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
                    onFocus={selectOnFocus}
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
                    onFocus={selectOnFocus}
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
              date={values.trade_date}
              getFilenameSuffix={async () => `trade-${await getTradeOrdinal()}`}
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

          <ReflectionSection control={control} values={values} />

          {/* On smaller screens the grid collapses to a single column; the
              buttons go last so they appear after Reflection. */}
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
