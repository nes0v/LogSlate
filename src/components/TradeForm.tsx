import { useEffect, useMemo } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2, Upload, X } from 'lucide-react'
import { emptyForm, formToDraft, tradeFormSchema, type TradeFormValues } from '@/lib/form-schema'
import type { TradeDraft } from '@/db/types'
import {
  computeAhpc,
  computeDuration,
  computeFees,
  computeGrossPnl,
  computeNetPnl,
  computeRealizedRr,
  effectivePnl,
  inferSide,
  totalContracts,
} from '@/lib/trade-math'
import { Pills } from '@/components/form/Pills'
import { Field, inputClass } from '@/components/form/Field'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

// Select all on focus so typing replaces the default (e.g. 0) instead of
// requiring the user to manually clear it first.
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
  { value: 'meh', label: '🥚 meh' },
] as const

interface TradeFormProps {
  initialValues?: TradeFormValues
  initialDate: string // YYYY-MM-DD
  onSubmit: (draft: TradeDraft) => Promise<void> | void
  onCancel: () => void
  submitLabel?: string
}

export function TradeForm({ initialValues, initialDate, onSubmit, onCancel, submitLabel = 'Save trade' }: TradeFormProps) {
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

  const buys = useFieldArray({ control, name: 'buys' })
  const sells = useFieldArray({ control, name: 'sells' })

  const values = useWatch({ control }) as TradeFormValues

  // Build a synthetic record (ISO timestamps combined from trade_date + time)
  // so the trade-math helpers can operate against in-progress form data.
  const synthetic = useMemo(() => {
    function toIso(time: string | undefined) {
      if (!time || !/^\d{2}:\d{2}$/.test(time)) return ''
      return `${values.trade_date ?? initialDate}T${time}:00`
    }
    const buys = (values.buys ?? []).map(b => ({
      price: Number(b?.price) || 0,
      contracts: Number(b?.contracts) || 0,
      time: toIso(b?.time),
    }))
    const sells = (values.sells ?? []).map(s => ({
      price: Number(s?.price) || 0,
      contracts: Number(s?.contracts) || 0,
      time: toIso(s?.time),
    }))
    return {
      buys,
      sells,
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
  const effPnl = effectivePnl(synthetic)
  const ahpc = computeAhpc(synthetic)
  const realRr = computeRealizedRr(synthetic)

  const screenshotPreview = values.screenshot ?? null

  async function handleScreenshot(file: File | null) {
    if (!file) {
      setValue('screenshot', null, { shouldDirty: true })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setValue('screenshot', String(reader.result), { shouldDirty: true })
    reader.readAsDataURL(file)
  }

  // Reset form when initialValues changes (e.g., navigating from one trade to another).
  useEffect(() => {
    if (initialValues) {
      // no-op: useForm takes defaultValues once; parent is expected to key by id.
    }
  }, [initialValues])

  async function submit(v: TradeFormValues) {
    await onSubmit(formToDraft(v))
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

        <ExecutionArray
          title="Buys"
          items={buys.fields}
          onAdd={() => buys.append({ price: 0, time: '', contracts: 1 })}
          onRemove={i => buys.remove(i)}
          register={register}
          errors={errors.buys}
          name="buys"
        />

        <ExecutionArray
          title="Sells"
          items={sells.fields}
          onAdd={() => sells.append({ price: 0, time: '', contracts: 1 })}
          onRemove={i => sells.remove(i)}
          register={register}
          errors={errors.sells}
          name="sells"
        />

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
          <Field label="Drawdown / MAE ($)" error={errors.drawdown?.message}>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              onFocus={selectOnFocus}
              {...register('drawdown', { valueAsNumber: true })}
            />
          </Field>
          <Field label="Buildup / MFE ($)" error={errors.buildup?.message}>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              onFocus={selectOnFocus}
              {...register('buildup', { valueAsNumber: true })}
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
          <Field
            label="PnL override ($)"
            hint="Leave blank to use the computed net PnL"
          >
            <Controller
              control={control}
              name="pnl_override"
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

        <section>
          <Field label="Screenshot">
            <div className="flex items-start gap-3">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-(--color-border) bg-(--color-panel) hover:bg-(--color-panel-2) cursor-pointer">
                <Upload className="size-4" />
                <span>Upload</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => handleScreenshot(e.target.files?.[0] ?? null)}
                />
              </label>
              {screenshotPreview && (
                <div className="relative">
                  <img
                    src={screenshotPreview}
                    alt=""
                    className="max-h-32 rounded-md border border-(--color-border)"
                  />
                  <button
                    type="button"
                    onClick={() => handleScreenshot(null)}
                    className="absolute -top-2 -right-2 size-6 rounded-full bg-(--color-panel-2) border border-(--color-border) flex items-center justify-center text-(--color-text-dim) hover:text-(--color-text)"
                    aria-label="Remove screenshot"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
            </div>
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
        <PreviewRow label="Side" value={side ? side : '—'} accent={side === 'long' ? 'win' : side === 'short' ? 'loss' : undefined} />
        <PreviewRow label="Contracts" value={contracts || '—'} />
        <PreviewRow label="Duration" value={formatDuration(dur.total_ms)} />
        <PreviewRow label="To first exit" value={formatDuration(dur.before_first_exit_ms)} />
        <div className="border-t border-(--color-border) my-2" />
        <PreviewRow label="Gross PnL" value={gross === null ? '—' : formatUsd(gross, { precise: true })} accent={pnlAccent(gross)} />
        <PreviewRow label="Fees" value={formatUsd(-fees, { precise: true })} accent="dim" />
        <PreviewRow label="Net PnL" value={net === null ? '—' : formatUsd(net, { precise: true })} accent={pnlAccent(net)} />
        {values.pnl_override !== null && values.pnl_override !== undefined && (
          <PreviewRow label="Effective PnL" value={effPnl === null ? '—' : formatUsd(effPnl, { precise: true })} accent={pnlAccent(effPnl)} />
        )}
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

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs === 0 ? `${m}m` : `${m}m ${rs}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`
}

interface ExecutionArrayProps {
  title: string
  items: Array<{ id: string }>
  onAdd: () => void
  onRemove: (index: number) => void
  register: ReturnType<typeof useForm<TradeFormValues>>['register']
  errors: { message?: string; [index: number]: unknown } | undefined
  name: 'buys' | 'sells'
}

function ExecutionArray({ title, items, onAdd, onRemove, register, errors, name }: ExecutionArrayProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-(--color-border) text-(--color-text-dim) hover:text-(--color-text)"
        >
          <Plus className="size-3" /> Add row
        </button>
      </div>
      {errors && 'message' in errors && errors.message && (
        <div className="text-xs text-(--color-loss)">{errors.message}</div>
      )}
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={item.id} className="grid grid-cols-[1fr_1fr_80px_32px] gap-2 items-center">
            <input
              type="number"
              step="0.01"
              placeholder="Price"
              className={inputClass}
              onFocus={selectOnFocus}
              {...register(`${name}.${i}.price`, { valueAsNumber: true })}
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="HH:MM"
              maxLength={5}
              pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$"
              className={cn(inputClass, 'font-mono')}
              onFocus={selectOnFocus}
              {...register(`${name}.${i}.time`)}
            />
            <input
              type="number"
              step="1"
              placeholder="Qty"
              className={inputClass}
              onFocus={selectOnFocus}
              {...register(`${name}.${i}.contracts`, { valueAsNumber: true })}
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              disabled={items.length === 1}
              aria-label="Remove row"
              className="size-8 rounded-md text-(--color-text-dim) hover:text-(--color-loss) disabled:opacity-30 flex items-center justify-center"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
