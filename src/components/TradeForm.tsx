import { useMemo } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { emptyForm, formToDraft, tradeFormSchema, type TradeFormValues } from '@/lib/form-schema'
import type { TradeDraft } from '@/db/types'
import {
  computeAhpc,
  computeDuration,
  computeFees,
  computeGrossPnl,
  computeNetPnl,
  computeRealizedRr,
  inferSide,
  totalContracts,
} from '@/lib/trade-math'
import { Pills } from '@/components/form/Pills'
import { Field, inputClass } from '@/components/form/Field'
import { ScreenshotField } from '@/components/ScreenshotField'
import { formatDuration } from '@/lib/duration'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select()

const SYMBOLS = [
  { value: 'NQ', label: 'NQ' },
  { value: 'ES', label: 'ES' },
] as const
const CONTRACT_TYPES = [
  { value: 'micro', label: 'Micro' },
  { value: 'mini', label: 'Mini' },
] as const
const SESSIONS = [
  { value: 'pre', label: 'Pre' },
  { value: 'AM', label: 'AM' },
  { value: 'LT', label: 'LT' },
  { value: 'PM', label: 'PM' },
  { value: 'aft', label: 'Aft' },
] as const
const PLANNED_RR = [1, 2, 3, 4, 5, 6, 7].map(v => ({ value: v as 1 | 2 | 3 | 4 | 5 | 6 | 7, label: `${v}x` }))
const RATINGS = [
  { value: 'good', label: '👍 good' },
  { value: 'excellent', label: '🔥 excellent' },
  { value: 'egg', label: '🥚 egg' },
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
    mode: 'onChange',
  })

  const executions = useFieldArray({ control, name: 'executions' })
  const values = useWatch({ control }) as TradeFormValues

  // Build a synthetic record so the trade-math helpers can operate on in-progress form data.
  const synthetic = useMemo(() => {
    function toIso(time: string | undefined) {
      if (!time || !/^\d{2}:\d{2}$/.test(time)) return ''
      return `${values.trade_date ?? initialDate}T${time}:00`
    }
    const execs = (values.executions ?? []).map(e => ({
      kind: (e?.kind ?? 'buy') as 'buy' | 'sell',
      price: Number(e?.price) || 0,
      contracts: Number(e?.contracts) || 0,
      time: toIso(e?.time),
    }))
    return {
      executions: execs,
      symbol: values.symbol ?? 'NQ',
      contract_type: values.contract_type ?? 'micro',
      stop_loss: Number(values.stop_loss) || 0,
      pnl_override: values.pnl_override ?? null,
    }
  }, [values, initialDate])

  const side = inferSide(synthetic)
  const contracts = totalContracts(synthetic)
  const dur = computeDuration(synthetic)
  const fees = computeFees(synthetic)
  const gross = computeGrossPnl(synthetic)
  const net = computeNetPnl(synthetic)
  const ahpc = computeAhpc(synthetic)
  const realRr = computeRealizedRr(synthetic)

  async function submit(v: TradeFormValues) {
    await onSubmit(formToDraft(v))
  }

  // Default a new row's kind to whichever is currently under-represented;
  // keeps scaling flows natural (add buys to enter, then sells to exit).
  function addExecution() {
    const current = values.executions ?? []
    const buys = current.filter(e => e?.kind === 'buy').length
    const sells = current.filter(e => e?.kind === 'sell').length
    executions.append({ kind: buys <= sells ? 'buy' : 'sell', price: 0, time: '', contracts: 1 })
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="grid lg:grid-cols-[1fr_280px] gap-6">
      <div className="space-y-6">
        <section className="flex flex-wrap items-end gap-4">
          <Field label="Date" className="w-36">
            <input type="date" className={inputClass} {...register('trade_date')} />
          </Field>
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
        </section>

        <Field label="Idea" error={errors.idea?.message}>
          <textarea
            className={cn(inputClass, 'min-h-40 resize-y')}
            placeholder="Trade thesis, setup, context…"
            {...register('idea')}
          />
        </Field>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Executions</h2>
            <button
              type="button"
              onClick={addExecution}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
            >
              <Plus className="size-3" /> Add execution
            </button>
          </div>
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
                className="grid grid-cols-[auto_1fr_1fr_80px_32px] gap-2 items-center"
              >
                <Controller
                  control={control}
                  name={`executions.${i}.kind`}
                  render={({ field }) => (
                    <Pills value={field.value} onChange={field.onChange} options={EXECUTION_KINDS} />
                  )}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Price"
                  className={inputClass}
                  onFocus={selectOnFocus}
                  {...register(`executions.${i}.price`, { valueAsNumber: true })}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="HH:MM"
                  maxLength={5}
                  pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$"
                  className={cn(inputClass, 'font-mono')}
                  onFocus={selectOnFocus}
                  {...register(`executions.${i}.time`)}
                />
                <input
                  type="number"
                  step="1"
                  placeholder="Qty"
                  className={inputClass}
                  onFocus={selectOnFocus}
                  {...register(`executions.${i}.contracts`, { valueAsNumber: true })}
                />
                <button
                  type="button"
                  onClick={() => executions.remove(i)}
                  disabled={executions.fields.length <= 2}
                  aria-label="Remove execution"
                  className="size-8 rounded-md text-(--color-text-dim) hover:text-(--color-loss) disabled:opacity-30 flex items-center justify-center"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <Field label="Stop loss ($)" error={errors.stop_loss?.message}>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              onFocus={selectOnFocus}
              {...register('stop_loss', { valueAsNumber: true })}
            />
          </Field>
          <Field label="Drawdown ($)" error={errors.drawdown?.message}>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              onFocus={selectOnFocus}
              {...register('drawdown', { valueAsNumber: true })}
            />
          </Field>
          <Field label="Buildup ($)" hint="Optional" error={errors.buildup?.message}>
            <Controller
              control={control}
              name="buildup"
              render={({ field }) => (
                <input
                  type="number"
                  step="0.01"
                  className={inputClass}
                  onFocus={selectOnFocus}
                  value={field.value ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    field.onChange(v === '' ? null : Number(v))
                  }}
                />
              )}
            />
          </Field>
        </section>

        <section className="flex flex-wrap gap-6">
          <Field label="Planned R:R">
            <Controller
              control={control}
              name="planned_rr"
              render={({ field }) => <Pills value={field.value} onChange={field.onChange} options={PLANNED_RR} />}
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

        <section>
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

        <div className="flex items-center gap-2 pt-2 border-t border-(--color-border)">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-1.5 text-sm rounded-md bg-(--color-accent) text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
          >
            Cancel
          </button>
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 self-start bg-(--color-panel) border border-(--color-border) rounded-md p-4">
        <div className="text-xs text-(--color-text-dim) uppercase tracking-wider">Live preview</div>
        <PreviewRow label="Side" value={side === 'long' ? 'buy' : side === 'short' ? 'sell' : '—'} accent={side === 'long' ? 'win' : side === 'short' ? 'loss' : undefined} />
        <PreviewRow label="Contracts" value={contracts || '—'} />
        <PreviewRow label="Duration" value={formatDuration(dur.total_ms)} />
        <PreviewRow label="To first exit" value={formatDuration(dur.before_first_exit_ms)} />
        <div className="border-t border-(--color-border) my-2" />
        <PreviewRow label="Gross PnL" value={gross === null ? '—' : formatUsd(gross)} accent={pnlAccent(gross)} />
        <PreviewRow label="Fees" value={formatUsd(-fees)} accent="dim" />
        <PreviewRow label="Net PnL" value={net === null ? '—' : formatUsd(net)} accent={pnlAccent(net)} />
        <div className="border-t border-(--color-border) my-2" />
        <PreviewRow label="AHPC" value={ahpc === null ? '—' : ahpc.toFixed(2) + ' h'} />
        <PreviewRow label="Realized R:R" value={realRr === null ? '—' : `${realRr.toFixed(2)}x`} accent={realRr !== null ? (realRr > 0 ? 'win' : realRr < 0 ? 'loss' : 'dim') : undefined} />
      </aside>
    </form>
  )
}

function PreviewRow({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent?: 'win' | 'loss' | 'dim'
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-(--color-text-dim)">{label}</span>
      <span
        className={cn(
          'font-mono',
          accent === 'win' && 'text-(--color-win)',
          accent === 'loss' && 'text-(--color-loss)',
          accent === 'dim' && 'text-(--color-text-dim)',
          !accent && 'text-(--color-text)',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function pnlAccent(n: number | null): 'win' | 'loss' | 'dim' | undefined {
  if (n === null) return 'dim'
  if (n > 0) return 'win'
  if (n < 0) return 'loss'
  return 'dim'
}
